import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const supplied = process.argv.slice(2).filter(a=>!a.startsWith('--'));
const inputPaths = supplied.length ? supplied.map(p=>path.resolve(p)) : [path.join(root,'content/articles.json')];
const articles = inputPaths.flatMap(p=>JSON.parse(fs.readFileSync(p,'utf8')));
const slugs = new Set();
for (const a of articles) {
  if (!a.slug || !a.title || !Array.isArray(a.blocks)) throw new Error('Article requires slug, title, blocks');
  if (slugs.has(a.slug)) throw new Error(`Duplicate slug: ${a.slug}`);
  slugs.add(a.slug);
}
const text = (s,style='normal',key='text')=>({_type:'block',_key:key,style,markDefs:[],children:[{_type:'span',_key:key+'-s',marks:[],text:String(s??'')}]});
const link = (label,url,key)=>({_type:'block',_key:key,style:'normal',markDefs:[{_type:'link',_key:key+'-l',href:url}],children:[{_type:'span',_key:key+'-s',marks:[key+'-l'],text:label}]});
const speechExpressions = new Set(['neutral','question','agree','explain','think']);
const convert = (b,i)=>{
 const key=`b-${i}`;
 if(b.type==='h2') return [text(b.text,'h2',key)];
 if(b.type==='p') return [text(b.text,'normal',key)];
 if(b.type==='question'||b.type==='answer') return [{_type:'meo_speech',_key:key,speaker:b.type,text:b.text,...(typeof b.expression==='string'&&speechExpressions.has(b.expression)?{expression:b.expression}:{})}];
 if(b.type==='note') return [{_type:'meo_note',_key:key,title:b.title,text:b.text}];
 if(b.type==='ul') return b.items.map((s,j)=>({...text(s,'normal',`${key}-${j}`),listItem:'bullet',level:1}));
 if(b.type==='table') return [{_type:'meo_table',_key:key,headersText:b.headers.join(' | '),rowsText:b.rows.map(r=>r.join(' | ')).join('\n')}];
 throw new Error(`Unsupported block: ${b.type}`);
};
const categoryNames=[...new Set(articles.map(a=>a.category))];
const categoryMap=Object.fromEntries(categoryNames.map((name,i)=>[name,`topic-${i+1}`]));
const previousSeedPath=path.join(root,'seed/seed.json');
const previousSeed=fs.existsSync(previousSeedPath)?JSON.parse(fs.readFileSync(previousSeedPath,'utf8')):null;
const previousIds=Object.fromEntries((previousSeed?.content?.posts??[]).map(p=>[p.slug,p.id]));
const posts=articles.map((a,i)=>({
 id:previousIds[a.slug]??`post-${a.slug}`,slug:a.slug,status:'draft',data:{title:a.title,excerpt:a.excerpt,
  content:[{_type:'meo_note',_key:'draft',title:'編集部初稿・公開前確認用',text:'本稿は構成確認用の下書きです。出典と記述を確認し、運営者・監修者を決めてから公開してください。会話の「薬局長」と「青葉まこと」は説明用の架空キャラクターです。実在の人物の発言や支援実績を表すものではありません。'},
  ...a.blocks.flatMap(convert),text('今日やること','h2','today-title'),text(a.today,'normal','today'),
  text('次に読む','h2','related-title'),...(a.related??[]).filter(s=>slugs.has(s)).map((s,j)=>link(articles.find(x=>x.slug===s).title,`/posts/${s}`,`related-${j}`)),
  text('出典・確認日','h2','sources-title'),...(a.sources??[]).map((s,j)=>link(`${s.title}（${s.kind==='vendor'?'提供企業の公表資料':'公式・一次資料'}／確認 ${s.checked}）`,s.url,`source-${j}`)),
  text('薬局の状況に合わせて進めたい方へ','h2','cta-title'),text('初期整備、継続保守、相談導線の改善は支援範囲が異なります。どこまで任せたいかを整理できます。','normal','cta-body'),link('MEO支援の内容を確認する','/services','cta-link')],
  reading_minutes:a.readMinutes,learning_order:i+1,review_status:'editorial_draft',related_slugs:a.related??[],source_records:a.sources??[]},
 bylines:[{byline:'byline-editorial'}],taxonomies:{category:[categoryMap[a.category]],tag:[]}
}));
const fields=[{slug:'title',label:'記事タイトル',type:'string',required:true,searchable:true},{slug:'featured_image',label:'見出し画像',type:'image'},{slug:'content',label:'本文',type:'portableText',searchable:true},{slug:'excerpt',label:'この記事で分かること',type:'text',searchable:true},{slug:'reading_minutes',label:'読む時間の目安',type:'integer'},{slug:'learning_order',label:'学習順',type:'integer'},{slug:'review_status',label:'編集確認',type:'string'},{slug:'related_slugs',label:'次の記事スラッグ',type:'json'},{slug:'source_records',label:'出典一覧',type:'json'}];
const seed={$schema:'https://emdashcms.com/seed.schema.json',version:'1',defaultLocale:'ja',meta:{name:'薬局MEOのやさしい教室',description:'薬局向けMEOを学び、実践するブログの初稿',author:'編集部（初稿）'},settings:{title:'薬局MEOのやさしい教室',tagline:'Googleマップで見つけてもらう仕組みから、自分でできること、代行・保守の選び方まで。薬局の現場に合わせて、会話と事例で解説します。',timezone:'Asia/Tokyo'},collections:[{slug:'posts',label:'記事',labelSingular:'記事',urlPattern:'/posts/{slug}',supports:['drafts','revisions','preview','search','seo'],commentsEnabled:false,fields},{slug:'pages',label:'固定ページ',labelSingular:'固定ページ',urlPattern:'/pages/{slug}',supports:['drafts','revisions','preview','search','seo'],fields:[fields[0],fields[2]]}],taxonomies:[{name:'category',label:'学ぶテーマ',labelSingular:'テーマ',hierarchical:true,collections:['posts'],terms:categoryNames.map(name=>({slug:categoryMap[name],label:name}))},{name:'tag',label:'タグ',labelSingular:'タグ',hierarchical:false,collections:['posts'],terms:[]}],bylines:[{id:'byline-editorial',slug:'editorial',displayName:'編集部（初稿）'}],menus:[{name:'primary',label:'メインメニュー',items:[{type:'custom',label:'はじめての方へ',url:'/'},{type:'custom',label:'すべての記事',url:'/posts'},{type:'custom',label:'初期整備・保守',url:'/services'},{type:'custom',label:'相談内容を整理',url:'/contact'}]}],widgetAreas:[{name:'sidebar',label:'記事のサイドバー',widgets:[{type:'component',componentId:'core:categories',title:'テーマから探す'}]},{name:'footer',label:'フッター',widgets:[]}],content:{posts,pages:[]}};
fs.mkdirSync(path.join(root,'content'),{recursive:true});
fs.writeFileSync(path.join(root,'content/articles.json'),JSON.stringify(articles,null,2)+'\n');
fs.writeFileSync(path.join(root,'seed/seed.json'),JSON.stringify(seed,null,2)+'\n');
const demo=structuredClone(seed);demo.content.posts.forEach(p=>p.status='published');demo.settings.title+='｜ローカル確認用';
fs.writeFileSync(path.join(root,'seed/demo.seed.json'),JSON.stringify(demo,null,2)+'\n');
console.log(`Prepared ${articles.length} draft articles; separate demo seed has local-only published copies.`);

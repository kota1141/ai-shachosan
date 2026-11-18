import { definePlugin } from 'emdash';
export function createPlugin() {
  return definePlugin({
    id: 'pharmacy-meo-blocks', version: '1.0.0',
    admin: { portableTextBlocks: [
      { type: 'meo_speech', label: 'MEOの会話', icon: 'code', fields: [
        { type: 'select', action_id: 'speaker', label: '話し手（架空の案内役）', options: [{label:'薬局長（質問）',value:'question'},{label:'青葉まこと（解説）',value:'answer'}] },
        { type: 'select', action_id: 'expression', label: '表情（任意・人物に合わない場合は通常）', options: [{label:'通常',value:'neutral'},{label:'質問（薬局長）',value:'question'},{label:'納得（薬局長）',value:'agree'},{label:'解説（青葉）',value:'explain'},{label:'考える（青葉）',value:'think'}] },
        { type: 'text_input', action_id: 'text', label: 'せりふ', multiline: true },
      ] },
      { type: 'meo_note', label: '大切なポイント', icon: 'code', fields: [
        { type: 'text_input', action_id: 'title', label: '見出し' },
        { type: 'text_input', action_id: 'text', label: '本文', multiline: true },
      ] },
      { type: 'meo_table', label: '比較表', icon: 'code', fields: [
        { type: 'text_input', action_id: 'headersText', label: '見出し（ | で区切る）' },
        { type: 'text_input', action_id: 'rowsText', label: '1行ずつ入力、列は | で区切る', multiline: true },
      ] },
    ] },
  });
}
export default createPlugin;

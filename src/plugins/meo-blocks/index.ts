import { definePlugin } from 'emdash';
export function createPlugin() {
  return definePlugin({
    id: 'pharmacy-meo-blocks', version: '1.0.0',
    admin: { portableTextBlocks: [
      { type: 'meo_speech', label: 'MEOの会話', icon: 'code', fields: [
        { type: 'select', action_id: 'speaker', label: '話し手（架空の案内役）', options: [{label:'質問する店長',value:'question'},{label:'解説する薬剤師',value:'answer'}] },
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

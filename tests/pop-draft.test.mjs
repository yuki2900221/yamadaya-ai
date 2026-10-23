import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePopDraft, serializePopDraft} from '../src/pop-draft.js';
import {DESIGN_CHOICES} from '../shared/proposal-policy.js';
import {PAPERS, POP_DESIGN_NOTES_MAX} from '../shared/contracts.mjs';

const base = {format:'yamadaya-pop-draft',version:1,prompt:'架空りんご  398円・税込　',paper:'a4p',mood:'明るく'};

test('legacy drafts restore their exact source and never trust a saved provider plan', () => {
  const restored = parsePopDraft(JSON.stringify({...base,plan:{headline:'未入力の効能',direction:'A4をA3に変える'},confirmed:true}));
  assert.deepEqual(restored,{prompt:base.prompt,paper:'a4p',mood:'明るく',designNotes:'',designDirection:null});
});

test('design notes and free/preset selection survive draft serialization for all four papers', () => {
  for(const paper of Object.keys(PAPERS)) for(const designDirection of ['',...Object.values(DESIGN_CHOICES)]) {
    const original={...base,paper,designNotes:'白と紺。写真は右・価格は左。\n余白を多めに。',designDirection,plan:{copy:''}};
    const restored=parsePopDraft(serializePopDraft(original));
    assert.deepEqual(restored,{prompt:base.prompt,paper,mood:base.mood,designNotes:original.designNotes,designDirection});
    assert.ok(!Object.hasOwn(restored,'plan'));
  }
});

test('untrusted drafts reject oversized or malformed design preferences before restoring state', () => {
  assert.equal(parsePopDraft(JSON.stringify({...base,designNotes:'あ'.repeat(POP_DESIGN_NOTES_MAX)})).designNotes.length,POP_DESIGN_NOTES_MAX);
  for(const extra of [{designNotes:'あ'.repeat(POP_DESIGN_NOTES_MAX+1)},{designNotes:null},{designNotes:{}},{designDirection:'赤いSALE・半額'},{designDirection:[]},{paper:'__proto__'},{prompt:' '}]) {
    assert.throws(()=>parsePopDraft(JSON.stringify({...base,...extra})));
  }
  assert.throws(()=>parsePopDraft('null'));
});

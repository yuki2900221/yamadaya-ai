import React, {useId} from 'react';
import {Icon} from './icons.jsx';
import {PAPERS, POP_DESIGN_NOTES_MAX} from '../shared/contracts.mjs';
import {DESIGN_CHOICES, popHeadlineChoices, popCopyChoices} from '../shared/proposal-policy.js';

const DESIGN_LABELS = {
  lively: '明るい・オレンジ系',
  fresh: '自然・緑と生成り',
  premium: '落ち着き・濃色と金',
  friendly: 'やさしい・ピンク系',
};

function Choice({label, value, hint, options, onChange}) {
  const id = useId();
  return <div className="field">
    <label className="field-label" htmlFor={id}>{label}</label>
    <select id={id} value={value} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <small id={`${id}-hint`}>{hint}</small>
  </div>;
}

export function PopProposal({plan, paper, prompt, reference, designNotes, confirmed,
  aiPaused, onPlanChange, onDesignNotesChange, onConfirmedChange, onCreate, onBack}) {
  const notesId = useId();
  const custom = plan.direction === '';
  const textOptions = values => values.map(value => ({value, label: value || '入れない'}));
  return <div className="split-layout pop-proposal-layout">
    <form className="surface glass" onSubmit={event => {event.preventDefault(); if (confirmed && !aiPaused) onCreate();}}>
      <div className="section-bar"><h2>提案を確認</h2><span className="mini-pill">{PAPERS[paper].label} 固定</span></div>
      <p className="muted tiny">選び直さなければ、表示中の内容で作成します。文章は元の商品情報から選べます。</p>
      <Choice label="見出し（任意）" value={plan.headline} options={textOptions(popHeadlineChoices(prompt))}
        onChange={headline => onPlanChange({headline})}
        hint={plan.headline
          ? '選んだ文章を、大きく目立たせるよう指定します。'
          : '見出し用の文章は追加しません。商品名・価格などの元情報は残します。'}/>
      <Choice label="キャッチコピー（任意）" value={plan.copy} options={textOptions(popCopyChoices(prompt))}
        onChange={copy => onPlanChange({copy})}
        hint={plan.copy
          ? '商品を補足する短い文章として添えます。「入れない」なら追加のコピーは付けません。'
          : '追加のキャッチコピーは付けません。元の商品情報に含まれる説明は残します。'}/>
      <div className="pop-design-group">
        <Choice label="配色・構図のベース" value={plan.direction}
          options={[...Object.entries(DESIGN_CHOICES).map(([key, value]) => ({value, label: DESIGN_LABELS[key]})),
            {value: '', label: '自由に指定（定型を使わない）'}]}
          onChange={direction => onPlanChange({direction})}
          hint={custom
            ? '定型の色や配置を使いません。下の希望が空欄なら、選んだ雰囲気に合わせてAIに任せます。'
            : '選んだデザインを土台にします。下に希望を入れると、色や配置を調整できます。'}/>
        <div className="field pop-design-notes">
          <label className="field-label" htmlFor={notesId}>デザインの希望（任意）</label>
          <textarea id={notesId} value={designNotes} maxLength={POP_DESIGN_NOTES_MAX} rows={4}
            aria-describedby={`${notesId}-hint ${notesId}-count`}
            placeholder="例：白と紺を中心に。商品写真は右に大きく、価格は左下。余白を広く、文字は手書き風に。"
            onChange={event => onDesignNotesChange(event.target.value)}/>
          <small id={`${notesId}-hint`}>色・配置・文字の雰囲気などを指定できます。商品情報や価格を変える場合は「情報を修正」へ。</small>
          <small className="character-count" id={`${notesId}-count`}>{designNotes.length} / {POP_DESIGN_NOTES_MAX}文字</small>
        </div>
      </div>
      <label className="check-row"><input type="checkbox" checked={confirmed} onChange={event => onConfirmedChange(event.target.checked)}/>
        <span>商品情報・提案・写真を確認しました。OpenAIへ送り、POPを1枚作成します。</span></label>
      <button type="submit" className="button primary full" disabled={aiPaused || !confirmed}><Icon name="spark"/><span>この内容でPOPを作成</span></button>
      <button type="button" className="button quiet" onClick={onBack}><span>情報を修正</span></button>
    </form>
    <aside className="surface glass source-panel">
      <h2>元の商品情報</h2><p className="source-text">{prompt}</p>
      {reference && <img className="reference-preview" src={reference} alt="参照する元の商品写真"/>}
      <div className="source-meta"><span>用紙</span><strong>{PAPERS[paper].label} · {PAPERS[paper].width} × {PAPERS[paper].height} mm</strong></div>
      <div className="pop-text-summary">
        <h2>今回の文字指定</h2>
        <dl><div><dt>見出し</dt><dd>{plan.headline || '入れない'}</dd></div>
          <div><dt>キャッチコピー</dt><dd>{plan.copy || '入れない'}</dd></div></dl>
        <p className="muted tiny">「入れない」は追加の文字指定を省く選択です。元の商品情報を削除するものではありません。</p>
      </div>
      <ul className="checks-list">{plan.checks.map((check, index) => <li key={index}><Icon name="check" size={16}/>{check}</li>)}</ul>
    </aside>
  </div>;
}

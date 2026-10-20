export const END_PENDING_KEY = 'yamadaya-end-unconfirmed';
export const PENDING_JOB_KEY = 'yamadaya-pending';

// Only a flag and operation UUID survive a failed close; never input or output.
export function createSessionLifecycle({ storage, session, end }) {
  let version = 0, ending = storage.getItem(END_PENDING_KEY) === '1', closing;
  return {
    capture: () => version,
    isEnding: () => ending,
    canPublish: ticket => ticket === version && !ending,
    beginEnd() {
      version++;
      ending = true;
      // A browser storage failure must never prevent clearing this screen.
      // The in-memory lock still applies, but cannot be guaranteed after reload.
      try { storage.setItem(END_PENDING_KEY, '1'); return true; }
      catch { return false; }
    },
    confirmEnd(csrf) {
      if (closing) return closing;
      if (!ending) throw Error('Session closure was not requested.');
      closing = (async () => {
        // On reload, the cookie remains HttpOnly. Obtain only the CSRF token,
        // then close that session before allowing a fresh flow or result read.
        const token = csrf || (await session()).csrf;
        await end(token);
        storage.removeItem(PENDING_JOB_KEY);
        storage.removeItem(END_PENDING_KEY);
        ending = false;
        version++;
      })().finally(() => { closing = undefined; });
      return closing;
    },
  };
}

export function pauseMessage(info) {
  if (!info?.spendingPaused && !info?.stopReason) return '';
  switch (info.stopReason) {
    case 'NOT_IMPORTED': return '接続準備中のため、生成を停止しています。入力の編集と保存は利用できます。';
    case 'TRIAL_EXPIRED': return '試用の許可期限が終了したため、生成を停止しています。入力の編集と保存は利用できます。';
    case 'COST_UNCERTAIN': return '費用が未確定の処理があるため、AI送信を停止しています。入力の編集と保存は利用できます。';
    default: return '利用状態の確認のため、生成を停止しています。入力の編集と保存は利用できます。';
  }
}

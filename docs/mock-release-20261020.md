# 専用クラウドモックへの修正版反映（2026-10-20）

ユーザーの「とりあえず1はやっちゃうか」により、[ローカル受入確認で検証した修正](mac-local-acceptance-20261020.md)を既存GitHubと既存の専用クラウドモックへ反映する。実AI、台帳import、認証条件・端末登録・秘密・期限の変更、新規契約は対象外。

## 反映前の確認

- GitHubは `yuki2900221/yamadaya-ai` の既存 `main`。試用アプリをルートに配置する既存構成を保ち、公開許可リストのソース・ダミー試験・報告だけを更新する。親案件・実台帳・参照写真・生成物・秘密を追加しない。
- Vercelは既存team `yuki-yamadaya` の既存project `yamadaya-ai-trial`。Git連携なし。GitHubのpushで自動配備されないことを読み取り確認した。
- 反映前Productionは `dpl_4ULt3qTHqEWegkaNm54Gri6m7ops`、READY。固定aliasは `yamadaya-ai-trial.vercel.app`。問題が出たら既存の旧deploymentへ戻す。ただし旧版の既知不具合が解消したことにはならない。
- 既存Production専用のserver Secret 10件は名前・sensitive・targetだけ確認した。復号・値の表示・再保存はしない。OpenAI／VITEキーは存在しない。
- 隔離buildは自動284件合格後のソース29ファイルとhash一致、関数bundle244ファイル、公開static 0、実AI provider／ローカルharness 0。既存Workerは同じhashのため更新しない。
- **反映前から**Macの新しいChromeタブで `https://ai-mock.superyamadaya.com/` はCloudflareの遮断画面になった。今回の更新で生じた障害ではない。接続成功を推測せず、WAFや証明書検証を緩めない。通常Chromeの安定接続と実2台受入は未合格。

## 実施結果

**ソース公開と専用モックへの修正版反映は完了。実2台受入と接続安定性は未完了。**

| 対象 | 実施と結果 |
|---|---|
| GitHub | 既存 `main` に [ソースcommit 00c5de4](https://github.com/yuki2900221/yamadaya-ai/commit/00c5de4) をpush。許可リスト86ファイルと公開treeは完全一致。元アプリ構成を保ち、56ファイルの追加／変更を反映 |
| 公開前検査 | 86ファイルの秘密パターン検出0。別agentが全原本hash、build対象29hash、diff、相対ファイルリンク67件／見出し28件を照合し問題0。秘密検査だけで漏洩の不存在を保証するものではない |
| 配備 | 検証済みprebuiltを既存projectへProduction／skip-domainで配備。244ファイルだけをupload対象とし、ソース作業領域・`.runtime`・環境ファイル・receiptは送らない。READY後にpromote成功 |
| 現配備 | `dpl_9E1EWpotH2D4iAFHo81jiXDyJPAV`、[配備詳細](https://vercel.com/yuki-yamadaya/yamadaya-ai-trial/9E1EWpotH2D4iAFHo81jiXDyJPAV)。Production／READY／sourceCommit `00c5de4` をAPIと管理画面で確認。固定aliasとsecondary aliasの個別APIで両方の移動を確認 |
| 既存設定 | 既存server環境10キーの名前・sensitive・Production targetは一致。Cloudflare Worker／WAF／mTLS／指紋、DB権限や期限は更新対象外で変更操作をしていない |
| Macの実接続 | 更新後のChrome再読み込みで従業員ログイン／証明書選択なしにホームと基本4画面を確認。DOMのJS `index-B_sZwKEG.js`、CSS `index-zvXH2H5F.css` が最終buildと一致 |
| 利用終了 | POPと文章にダミー入力し、終了確認→空のホームを確認。両入力が空、終了確認待ちが残らないことと、再読み込み後の接続成功を確認。検証タブのconsole error 0 |
| 生成停止 | クラウドは接続準備中の表示で生成ボタンは無効。今回ジョブ送信・実AI・画像生成・検索を実行していない。ローカル固定モックの生成／保存試験をクラウドで再実施した扱いにはしない |

`--skip-domain`でもsecondary aliasだけは新配備へ自動割当された。固定Worker用aliasが旧配備のままなのを別agentがAPIで確認した後、明示的にpromoteした。最終時点のalias個別endpointでは既存2本とも新配備を指す。project内の埋込alias配列はsecondaryのみのため、その配列だけで全aliasを判定していない。

### 反映後の実HTTP拒否試験

- 固定Vercel URLのホーム・session・jobs・admin・新JS・ロゴ・偽gateway proofの**7条件すべて403／GATEWAY_REQUIRED**、`private, no-store`。
- Cloudflare入口の証明書なし、証明書を偽るヘッダー付きの**2条件すべて403**。
- 固有deployment URLは**302でVercel SSOへ転送**。認証を迂回していない。

計10件の非認証HTTP試験と、Macの正規ブラウザ確認を区別する。これらは認証境界の確認であり、侵入試験や全端末／全経路の保証ではない。

### 接続安定性と戻し方

更新前の新規タブは403、更新後の再読み込みと利用終了後の再読み込みは成功した。Cloudflare／証明書設定を変えていないため、403の原因解消を今回のアプリ修正の効果とは断定しない。Chrome／OS再起動、Windows、実2台間隔離は未実施。

戻し先の旧deploymentは保持している。必要時は同じteamで `vercel rollback dpl_4ULt3qTHqEWegkaNm54Gri6m7ops --scope yuki-yamadaya` を実行し、固定aliasの復帰、Mac接続と否定試験を再確認する。CLI 59.26.0のrollback引数を確認済み。今回は新たな回帰を認めず、rollback自体は実行していない。旧版の既知不具合と新旧CSRFセッションの切替があるため、利用中の入力や結果が戻るとは案内しない。

### 証跡と未実施

非公開の作業記録は `/private/tmp/yamadaya-mock-rollout-preflight-20261020.json`、`yamadaya-mock-staged-preflight-20261020.json`、`yamadaya-mock-promoted-preflight-20261020.json`、`yamadaya-mock-postrelease-http-20261020.json`。更新前403、READY管理画面、更新後ホームのPNGも同じ一時領域へ保存した。秘密値やcookieを報告書へ記録せず、画像は公開repoへ含めない。一時領域の永続保存は保証しない。

自動284件は先行ローカル試験の結果であり、今回再実行した件数ではない。runtime source29件とその最終buildのhash一致を確認し、その同じ成果物を配備した。DBの構成変更・migration・管理者による直接照会、実台帳のimport／読取／変更は行っていない。ブラウザ試験に伴う専用モックの通常のセッション／nonce読み書きは発生する。過去に確認したjobs0／未import／paused状態を、今回のDB再照合結果とは記載しない。

追加実AI実行0、追加入金0、新規契約0。既存Vercel／Supabaseの通常利用は既存契約の使用量に含まれ、請求額の再集計は今回実施していない。Windows実機・安定接続・実2台受入・実AIの試用は残る。Release A全体を合格にしたものではない。

## 維持する境界

Cloudflare Custom Domain・Worker・WAF・mTLS・許可指紋、Supabaseのschema／権限／private Storage、元の接続期限 **2026-10-26 08:47:54 JST** は変更しない。未確定3件 **0.45ドル** と合計10ドル枠も変更・再送しない。追加実AI実行、追加入金、新規契約は行わない。

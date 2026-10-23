# POP提案の改善を既存3台限定試用版へ反映

日付: 2026-10-23（日本時間）
状態: 既存3台限定試用版への配備完了。認証の否定試験は成功、更新後の専用Chrome再読み込みでホーム・接続済み表示を本人確認。

## 承認範囲

ユーザーは[ローカル改善](pop-proposal-customization-20261023.md)を確認し、既存の3台限定試用版への反映を承認した。対象はPOP提案画面の見出し・キャッチコピーの説明、「入れない」の扱い、配色・構図の自由指定と最大500文字のデザイン希望、下書き保存・復元である。[ADR-0018](decisions/ADR-0018-pop-design-customization.md)を判断の正本とする。

既存Vercel `yamadaya-ai-trial`を更新し、指定3台・従業員ログイン不要・元の合計10 USD・未確定3件0.45 USDの保留・元期限2026-10-26 08:47:54 JSTを維持する。Cloudflareの端末認証条件・許可端末・Worker、DBの権限・既存台帳・予約精算、サーバーの秘密設定を変更する作業には広げない。追加AI実行、追加入金、新規契約、課金設定の変更は行わない。

## 配備前の確認

- 先行のローカル試験は自動360件中358成功・失敗0・既定skip2とビルド成功。実ブラウザで確認したのは分離した無課金操作見本であり、今回のクラウド更新後の結果とは区別する。
- 公開許可リスト111ファイルの秘密パターン検出0。隔離したBuild Output API bundleは247ファイル、公開static・symlink・秘密／管理用ファイルの混入0。明示オプション`--allow-live-provider`で既存の実AI用providerコードを許可して検査した。handlerのimportはAPIを実行しない。
- 独立agentがruntime16入力の原本・隔離ソース・bundle、frontend13入力の原本・隔離ソース、dist4ファイルとproduction依存223ファイルをSHA-256で照合し、不一致0。CLIのupload dry runで選択された247ファイルも、ローカル成果物のSHA-1と全件一致した。
- 既存team・project・Production・固定alias・戻し先をメタデータで照合。Git連携なしを確認した。Productionの既存15環境変数は名前・sensitive種別・対象が更新前後で一致し、`decrypt=false`の照会だけを使用した。秘密値の読取・再保存は行っていない。

正常終了分の予約精算は既に適用したDB関数を使用する。今回、migrationの再実行・台帳の再import・初期化は不要であり実施しない。[精算結果](reservation-settlement-20261021.md)は過去の実照合として扱い、今回の残高照会結果へ流用しない。

## 配備結果

| 対象 | 結果 |
|---|---|
| GitHub | 公開許可リストだけを既存mainへ反映。[ソースcommit `d02de72`](https://github.com/yuki2900221/yamadaya-ai/commit/d02de728e4fc411c594e20131bc109b75e3550e3)をpush済み |
| staged Production | 検査済みprebuiltを既存projectへ配備。`dpl_BF4QC8gaT2rz3oAAmFPJuJagb1sv`のREADYとsourceCommit一致を確認 |
| promote前 | 固有deployment URLはVercel SSOへ302。Workerが使う固定aliasは旧deploymentのままで、secondary aliasだけがstage時に新配備へ移動した。以前にも確認した挙動として個別に照合 |
| promote | **2026-10-23 14:16 JST**に成功。固定aliasとsecondary aliasの両方が新deploymentを指すことをメタデータで確認 |
| 設定・データ | 既存の環境変数、認証条件、予算・期限を変更する操作なし。Cloudflare Worker／WAF／証明書、DB権限／台帳／予約精算も更新対象外 |

更新先は[deployment詳細](https://vercel.com/yuki-yamadaya/yamadaya-ai-trial/BF4QC8gaT2rz3oAAmFPJuJagb1sv)、固有URLは`https://yamadaya-ai-trial-ca13ob5wa-yuki-yamadaya.vercel.app`。固有URLから認証を迂回して利用する案内は行わない。

Vercelのdeployment files APIが返すsource247ファイルのuid（SHA-1）とupload dry runの247件も全件一致し、missing／extra／mismatchは0だった。別の`out/app`1件はVercelが生成するlambdaメタデータである。これは配備されたファイル内容のhash確認であり、正規Mac経由のJS/CSS取得結果ではない。

配信照合に使用する成果物はJS `index-jmo3qMv9.js`（SHA-256 `f6d5c8a6c9338b9b25de290f364e3e7455adf1240cf731c9067fa3d35e9af228`）とCSS `index-VBiBgZe_.css`（SHA-256 `1c0e58b3966368c0749198fdb43e99482805a29c895e926470ffbf7863c0c3f8`）。この値はビルド成果物の照合値で、正規Mac経由の取得成功を意味しない。

## 配備後の試験と未確認

実HTTPの認証否定試験は**10条件中10成功**。

- 固定Vercel直接URLのホーム・API・asset・不正proof等7条件が403／`GATEWAY_REQUIRED`、`private, no-store`。
- Cloudflare入口の証明書なしと証明書情報を偽るヘッダー付きの2条件が403。
- 固有deployment URLの1条件が302でVercel SSOへ転送。単なる302を成功とせず転送先を確認した。

これらは認証境界の拒否確認であり、正規端末の画面表示や生成品質の試験ではない。

Macの非公開診断用URLSessionで既存の対象証明書とTLS 1.2を指定したGETを1回実行した。対象証明書・秘密鍵のガードは通ったが、ホームGETはTLSエラー`-1200`／HTTP `000`でHTMLを取得できず、assetは取得していない。自動再試行・鍵の作成や設定変更は行わなかった。この別クライアントの結果から、本人の専用Chromeも失敗した、または今回の配備による回帰が生じたとは断定しない。

本人が専用Chromeで⌘Rによる再読み込み後、「ホームとAI接続済みが表示された」と回答した。更新後のMac接続成功をユーザー申告として記録し、操作ツールによる画面・配信JS/CSSの独立取得照合とは区別する。提案確認・POP生成のボタンは押しておらず、新しい提案画面と実モデルによる生成は未試験。接続確認を生成品質の確認とは扱わない。通常のセッション／認証nonceの読み書きと、AIジョブの送信を区別する。

新deploymentを対象に`--no-follow --level error --since 10m --limit 20`で取得したruntime error logは0行だった。対象と観測期間を限定した照会であり、すべての期間・端末・操作でエラーがない保証にはしない。

会社Windows2台での更新後実操作、実モデルによる希望の反映、生成後PDFの再検査は未実施項目として残す。Macで配信更新を確認できても全3台の実操作を合格にしない。

## 戻し方

更新前のProduction `dpl_889uA5QfTt3Z7sSkWwiRgc5QsQSV`を保持。元の固有URLは`https://yamadaya-ai-trial-jepyspad0-yuki-yamadaya.vercel.app`。回帰が確認された場合は同じ既存projectの元deploymentへ戻し、固定alias・正規Mac接続・直接URL拒否を再確認する。今回はrollbackを実行していない。過去の既知不具合や利用中の画面状態まで復元できるとは案内しない。

## 結果と証跡

非公開の証跡は`/private/tmp/yamadaya-pop-rollout-preflight-20261023.json`、`yamadaya-pop-upload-dry-20261023.json`、`yamadaya-pop-staged-deployment-20261023.json`、`yamadaya-pop-staged-preflight-20261023.json`、`yamadaya-pop-staged-http-20261023.json`、`yamadaya-pop-promoted-preflight-20261023.json`、`yamadaya-pop-postrelease-http-20261023.json`へ分離した。APIキー・cookie・証明書・端末識別値・実台帳やスクリーンショットを公開ソースへ含めない。一時領域の永続保存は保証しない。

配備ファイルと限定期間のログ確認は`/private/tmp/yamadaya-pop-deployed-filetree-20261023.json`、`yamadaya-pop-deployed-files-check-20261023.json`、`yamadaya-pop-runtime-errors-20261023.jsonl`へ分離した。

今回の追加AI実行・追加入金・新規契約・課金設定変更は0。DB直接照会・migration・台帳import／変更、Cloudflare Worker／WAFの更新は行っていない。既存Vercel等の通常利用は既存契約の使用量に含まれ、今回の請求額再集計や残高照会は未実施。3台・累計10 USD・元の未確定0.45 USD・元期限を変更する操作はしていない。

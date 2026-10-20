# 専用Web試用への費用台帳引継ぎ

既存の合計10 USD、未確定3件の予約0.45 USD、元の期限（2026-10-26 08:47:54 JST）を引き継ぐ。新しい10 USD枠を作らない。ここに記したコマンドは管理PCでの準備手順であり、実行済み・実AI試用開始の報告ではない。

## 引継ぎの順序

1. 管理者が旧ローカル実AIサーバーを特定して停止し、listenerが消え、送信中0件であることを確認する。旧コードを動かしたままでは新設する凍結ガードが働かない。
2. `scripts/activate-hosted-trial.mjs export` で元SQLiteを凍結し、全ジョブの必要最小限のmetadataを非公開ファイルへ書く。本文・会話・写真・結果・キーを出力しない。元SQLiteの行と費用は変更せず、`trial_cutover` マーカーだけを追加する。新版のローカルサーバーも、このマーカーがあると新規予約を拒否する。
3. `verify` で、元SQLiteの全metadata、マーカー、ファイルのSHA-256、件数・予約・計算費用・未確定件数を再照合する。未知の送信中、保留額変更、期限延長、予算変更、snapshot改変があれば停止する。
4. 専用Supabase `yamadaya-ai-trial`（ref `pgcvetybmtvojpivfjdm`）だけで、`prepare-hosted-trial-db.mjs` が生成したレビュー済みSQLを実行する。既存の `yamadaya_mock` は保持し、新しい `yamadaya_trial` を空・未import・paused、3roleをNOLOGINで用意する。既存trial schema/roleや業務用public objectがあればrollbackする。SQL内のproject名は対象の証明にならないため、実行する管理画面のURLと表示名も照合する。
5. 別途承認された最小権限login・元期限内の端末登録・サーバー専用設定・実AI providerを準備する。runtimeには台帳import・予算変更・端末登録の権限を与えない。旧mockのキーや認証条件を暗黙に実試用へ流用しない。
6. `sql` で生成した非公開activation SQLを同専用projectへ一度だけ適用する。trial端末1〜2件と元期限、空のpaused台帳を確認し、全metadataを1transactionでimportする。元の未確定ID・予約額・入力hashを保持し、新しい未確定が生じたら再停止する。失敗時はimport行と予算の変更を全rollbackする。
7. 最小権限runtimeから費用集計を再照合し、元の保守的な全予約を含む残額の範囲だけで試す。費用はusage計算であり、請求照合済みとは扱わない。

## ローカルCLI

`shared-web` を作業ディレクトリにし、すべて絶対パスを指定する。入力は所有者一致の0600通常ファイル、出力は0600・上書き拒否で扱う。実際のsnapshotと生成SQLは公開許可リスト外の非公開フォルダに置く。

```sh
node scripts/activate-hosted-trial.mjs export --ledger /absolute/private/jobs.sqlite --snapshot /absolute/private/trial-snapshot.json --confirm-local-stopped
node scripts/activate-hosted-trial.mjs verify --ledger /absolute/private/jobs.sqlite --snapshot /absolute/private/trial-snapshot.json --confirm-local-stopped
node scripts/prepare-hosted-trial-db.mjs --output /absolute/private/trial-bootstrap.sql
node scripts/activate-hosted-trial.mjs sql --ledger /absolute/private/jobs.sqlite --snapshot /absolute/private/trial-snapshot.json --output /absolute/private/trial-activation.sql --confirm-local-stopped
```

これらのCLIはネットワーク・PostgreSQL・OpenAIへ接続せず、`.env` を読まない。exportで出力に失敗しても凍結は残る。保存先を直してexportを再実行し、古いサーバーを再開するためにマーカーを削除しない。

## 切替が失敗したとき

実AI配備をモックへ戻し、必要なら管理者が `yamadaya_trial.budget.paused=true` として送信を止める。元SQLiteの凍結、import済みmetadata、全予約・未確定を保持する。DBのdrop・再初期化・未確定の無料化・元入力の自動再送・旧localとcloudの同時再開は行わない。再開には一方のexecutorだけを使えることと同じ費用集計の照合が必要。

## 自動試験の範囲

架空metadataを使ったSQLite/PGlite試験で、凍結と再起動後拒否、sendingの拒否、全metadataのhash照合、0600出力、上書き拒否、mock/trialの分離、一度限りのimport、失敗rollback、runtimeのimport権限拒否を検証する。これらは実台帳・専用クラウド・実AI・Windowsの実機合格を意味しない。

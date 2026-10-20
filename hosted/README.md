# Hosted preparation

モックのみ。専用環境の設定実施状況・運用・試験・費用の正本は[公開準備報告](../docs/hosted-preparation.md)。実環境への追加設定・deployをこのREADMEだけで許可されたものと扱わない。

## 将来のサーバー専用設定

| 変数 | 用途 |
|---|---|
| HOSTED_MODE | 今回は`mock`だけ許可 |
| HOSTED_PROJECT_REF | 新しい専用Supabase project ID。既存業務project不可 |
| HOSTED_DATABASE_URL | `yamadaya_mock_web`専用login、TLS verify-full。migration owner/postgres/service_role不可 |
| HOSTED_DATABASE_CA | Supabase公式画面で取得した公開CA証明書PEM。実際の改行を含む。証明書・ホスト名の検証は無効にしない |
| HOSTED_PUBLIC_ORIGIN | 端末認証を適用するHTTPSサブドメイン。現時点未設定 |
| HOSTED_UPSTREAM_ORIGIN | 固定Vercel origin。直接URLのアクセスも署名必須 |
| HOSTED_GATEWAY_SECRET | Workerとorigin間の専用署名秘密。32bytes以上、browserへ渡さない |
| HOSTED_SESSION_SECRET | 別のsession用秘密。gateway秘密と共用しない |
| HOSTED_STORAGE_BUCKET | 新projectだけのprivate bucket |
| HOSTED_STORAGE_SERVER_KEY | 上記projectだけのサーバー資格情報。browserへ渡さない |
| HOSTED_APPROVED_DEVICES | Worker側のみ。管理者登録2台のid/証明書SHA256指紋 |

秘密はサーバー用Secretとして設定し、public変数・ログ・コマンド引数・Gitへ入れない。専用環境で承認済みの接続情報を発行・保存した現在の範囲は報告を参照。mock runtimeにはOpenAIキー変数を定義しない。新しい`sb_secret_*`はStorageへ`apikey`だけで送り、JWTとしてBearerへ入れない。

`mock-migration.mjs`でSQLを`yamadaya_mock` namespaceへ変換できる（文字列生成だけでSQL実行なし）。`scripts/prepare-hosted-db.mjs`は対象専用projectと標準RLS関数を照合するSQL案を生成する。既存role/schema/業務オブジェクトがあれば停止し、空・未import・送信停止で初期化する。実台帳用`yamadaya_trial`と権限/予算を混用しない。実台帳import・追加資格情報・実AI接続は別の確認対象。

非公開GCは`maintenance.mjs`の`cleanupImages`。実配備には5分以内ごとのschedulerと失敗通知が必要で未設定。Storage bytes削除→当該metadata削除→session/nonce掃除の順。独立inventoryが15分超の孤立objectも対象にする。1回100件までで、滞留が増えた場合の監視を必要とする。ローカルtest-only harnessの30秒timerはクラウドschedulerの代わりではない。

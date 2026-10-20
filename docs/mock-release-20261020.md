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

反映準備中。GitHubのcommit、配備、確認結果を実行後に追記する。先行のローカル試験は実クラウドでの合格には読み替えない。

## 維持する境界

Cloudflare Custom Domain・Worker・WAF・mTLS・許可指紋、Supabaseのschema／権限／private Storage、元の接続期限 **2026-10-26 08:47:54 JST** は変更しない。未確定3件 **0.45ドル** と合計10ドル枠も変更・再送しない。追加実AI実行、追加入金、新規契約は行わない。

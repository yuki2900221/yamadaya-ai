# 2端末試用の導入・保守を簡単にする構成比較

確認日: 2026-10-19。状態: **提案・未採用**。公式資料と現在の検証記録に基づく机上比較であり、代替構成の実機合格報告ではない。

今回実施したのは資料調査と本文書の作成のみ。アプリ・OS・DNS・Cloudflare・認証・契約の設定変更、新しい資格情報の発行、API実行、追加課金、クラウド配備は行っていない。

## 推奨

**今回の1週間・2台の試用では、WARP + private Tunnelを維持し、管理者の操作を少なくする案を推奨する。** 乗り換えよりも、起動・状態確認・停止・復旧の手順をまとめることを先に行う。継続利用を決めた段階で、手作業の証明書配布とMacの常時稼働を減らす。

これは既存構成が最も単純という意味ではない。Tailscaleには共用PCの利用条件、ブラウザ証明書方式には鍵配布・失効とDNS、クラウド移設には新たな保守・費用があり、現在確認できた範囲では、どれも無条件に導入と保守の両方を減らせないという判断である。既存の採用判断や要求を変更したものではない。

## 維持する条件

- 利用端末はこのMacと会社のWindows 11 / Chromeの計2台。会社の回線全体を許可する方式には広げない。
- 従業員の毎回のログインは不要。管理者の初回登録・端末入替時の再設定とは分ける。会社共用PCで私用Googleアカウントへログインしない。
- 基本4機能に限定し、管理操作、業務DB、社内LAN、ファイル操作等の権限を追加しない。APIキーはサーバー側にだけ置く。
- 単一Nodeと永続SQLiteの費用台帳、送信前記録、同一操作ID、予約額、未確定状態、自動再送の禁止を維持する。
- 既存のAPI合計上限$10、未確定3件の$0.45保留、試用期限を変更しない。ネットワーク接続の完成は、APIキーの期限更新や実AI利用の再開を意味しない。

## 比較

費用はUSD、2026-10-19の公表例。税、為替、API利用、超過利用は別。料金表は請求額の確約ではない。

| 構成 | 従業員の通常操作 | 初回導入・日常保守 | 費用と条件 | 今回の評価 |
|---|---|---|---|---|
| A. 現在のWARP + private Tunnelを整理 | WARP接続済みならブックマークを開く | 登録済み2台を再利用。WindowsのHTTPS信頼設定と接続試験が残る。Macの起動、connector、アプリ、期限の管理は必要 | 現在のCloudflare Freeの範囲で進める。追加有料機能は採用しない | **今回の第一候補**。新サービスを増やさず試用に進める |
| B. Tailscale + Serve | 接続が常駐すればブックマークを開く | 自動HTTPSと名前解決により証明書配布・Wix DNS・Tunnel/Gatewayを減らせる。ただし両端末のクライアント登録と通信制限、Mac起動は必要 | Standard $8/ユーザー/月。Personalは非商用用。社員が使う共用PCの登録方法・必要seat数は未確認 | 技術面は有力だが、**共用利用条件の確認前に採用しない** |
| C. ブラウザの端末証明書（mTLS）+ public Tunnel | 証明書の自動選択が成立すればブックマークを開く。WARPは不要 | 2台それぞれへのクライアント証明書配布、秘密鍵保護、失効、更新、公開入口と迂回防止の設定が必要 | Access mTLSは有料。別方式のzone-level mTLSはFree枠あり。ただしWix DNS維持の既存ドメインを無料でpublic Tunnelへ載せられるとは仮定しない | 従業員の操作は減るが、**管理者の手間が確実に減るとはいえない** |
| D. 既存Node/SQLiteを単一クラウドVMへ移す | 端末認証を維持すれば通常ログイン不要 | Macの起動・スリープ依存をなくせる。端末の入口管理に加え、OS更新、監視、バックアップと復元が必要 | 例: 1GiB VM $6/月 + 日次バックアップ30% = $7.80/月。入口やTLSの費用・管理は別途評価 | **継続利用時の候補**。今回の1週間だけでは移設負担が大きい |

料金・仕様の根拠: [Tailscale料金](https://tailscale.com/pricing)、[Access mTLS提供条件](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)、[zone-level mTLS](https://developers.cloudflare.com/api-shield/security/mtls/)、[VM料金](https://www.digitalocean.com/pricing/droplets)、[バックアップ料金](https://docs.digitalocean.com/products/backups/details/pricing/)。VMの1GiBで現在の全処理が安定するかは負荷試験していない。

## Aで簡単にする範囲

### 今回の短期試用

管理者向けに「起動」「状態確認」「停止」の入口をまとめ、停止理由を判別できるようにする案。アプリ、HTTPS、connector、登録端末、証明書・試用期限を確認対象にする。秘密値は表示せず、異常時は接続・AI送信を閉じたままにする。台帳の削除、未確定処理の再送、認可の緩和で復旧させない。これらの運用改善は**未実装**。

従業員には通常時のブックマークだけを案内し、Cloudflare管理画面、証明書の手動更新、APIキー操作は管理者に限定する。WARPの常時接続・自動起動は、既存業務通信や印刷への影響と再起動試験を確認してから判断する。現状のOffを変更していない。

現在の直接信頼するサーバー証明書は1週間の試用用であり、端末を認証するクライアント証明書とは別である。短期試用のためだけにDNS APIや証明書自動化を新たに構築するのは勧めない。試用を延長する場合は期限と更新作業を再評価する。

### 継続利用する場合

公開CAのサーバー証明書へ移すと、端末への独自証明書の信頼設定と更新時の再配布を減らせる。**HTTPSの証明書を変えても、端末の許可はWARP/Gatewayで維持する。** DNS-01認証ならアプリ自体をインターネットへ公開する必要はない。[Let's Encryptの認証方式](https://letsencrypt.org/docs/challenge-types/)

WixにはDNS更新APIがあるが、対象アカウントで使えるか、権限をどこまで絞れるか、ACMEとの連携、更新後のサーバー反映は未検証。「Wixでは自動更新不可」「既製設定だけで即完了」のどちらとも断定しない。[Wix Domain DNS API](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns)

安全性を維持するため、会社メインドメイン全体を編集できる資格情報を試用Macへ追加する前提にはしない。検証用のTXT範囲・専用検証先へのCNAME等の委任、資格情報の限定を先に設計する。DNS-01の検証先委任はCloudflareの子ゾーン契約とは別である。手動TXTの都度更新だけでは継続保守の簡略化にならない。

## Bの採用を保留する理由

Serveはtailnet内へHTTPSを提供し、Funnelによる一般公開とは異なる。現在の構成から証明書配布とDNS管理を減らせるという評価は公式機能からの推論であり、このアプリでは未試験。[Serve](https://tailscale.com/docs/features/tailscale-serve)

一方、公式資料はtagを非人間の機器向けとしており、利用者の端末の認証に使うことを禁止している。共用Windowsをtag付き端末にして社員アカウントを省く案は採用しない。管理者1人で登録した共用PCを全社員が利用できるか、必要seat数はいくつかについて明示的な適合確認が残る。[Tags](https://tailscale.com/docs/features/tags)

2端末だから2seatとも、1管理者だから全社員込み$8/月とも断定しない。共用端末の登録モデルと費用を提供元へ確認できた場合に再評価する。今回問い合わせ送信や契約は行っていない。

仮に採用しても、既定の全許可を残さず、承認したWindowsからMacのHTTPSだけを許可し、Nodeはloopback待受を維持する。端末承認、失効、再登録時の制限、Mac再起動時の復旧を実機で確認する。[Device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval)、[Grants](https://tailscale.com/docs/reference/syntax/grants)

## Cで区別する二つの方式

**Access mTLS**はService AuthでIdPへの通常ログインを不要にできるが、Free対象外。**zone-level mTLS**は別の機能で、Cloudflare管理CAの証明書をFreeでも100件まで発行できる。後者は証明書を作るだけでなく、対象ホストで未提示・無効・失効済みをWAFで拒否する必要がある。[Access mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)、[証明書上限](https://developers.cloudflare.com/ssl/client-certificates/create-a-client-certificate/)、[mTLS拒否設定](https://developers.cloudflare.com/api-shield/security/mtls/configure/)

Wixをauthoritative DNSに残したCloudflareのpartial/CNAME構成はBusiness/Enterprise、Cloudflareの子ゾーン構成はEnterprise対象。既存ドメイン全体のDNS移行を暗黙に行わない。独立した試験ドメインをCloudflare Freeのfull DNSで管理する案ならzone-level mTLSを検討できるが、別ドメインの準備と費用が生じ得る。[Partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)、[Subdomain setup](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/setup/)

Chromeには証明書自動選択のポリシーがあるが、実機への配布権限と挙動は未確認。証明書・秘密鍵をコピーすれば別端末で使える方式では「物理2台限定」の証明にならない。非エクスポートやOSの保護、端末ごとの許可・失効と、originへ直接接続できない構成を確認する。[Chromeのポリシー](https://chromeenterprise.google/intl/ja_jp/policies/auto-select-certificate-for-urls/)

## Dで維持するものと増えるもの

現在のNodeとSQLiteを1台のVMで維持すれば、台帳の保存先や処理方式を大きく変えず、Mac停止による会社PCの利用停止を避けられる。入口を現在と同じprivate Tunnelにする場合、Nodeはloopback、外部受信ポートは閉じたままとし、WARPの端末制限を引き継ぐ。ただし移設だけではHTTPSの証明書管理は解消しない。

VMの日次バックアップだけに依存せず、整合したSQLiteバックアップと復元を検証する。移設時は新規受付を止め、処理中・未確定の状態を整理してから一方だけを稼働させる。予算・予約額の初期化、未確定ジョブの自動再送はしない。[SQLite Backup API](https://www.sqlite.org/c3ref/backup_finish.html)

OS保守を減らすマネージドNodeも候補だが、永続ディスクと入口の迂回防止は別途必要。例としてRenderは計算資源$7/月 + ディスク$0.25/GB/月。1GBなら$7.25/月に相当するが、端末認証の費用を含む完成構成の見積りではない。ディスク付きサービスは単一インスタンスで、デプロイ時の停止も考慮する。[Render料金](https://render.com/pricing)、[ディスク制約](https://render.com/docs/disks)

今回の簡略化を目的にVercel/Workersへ全面移行する案は推奨しない。現在の永続SQLite台帳、長時間ジョブ、一時セッションの扱いを変える範囲が増えるためであり、それらのサービスが一般に不適切という判断ではない。

## 採用前に必要な検証

方式にかかわらず、次の合格が必要。今回の比較では実行していない。

1. 2台のChromeでHTTPS・基本4画面を利用でき、従業員のログインを要求しない。
2. 未登録端末、同じ会社LANの別端末、別Host/port、直接origin等からの迂回を拒否する。
3. 片方の端末だけを失効させ、開いているタブ・既存セッション・再接続・再起動後も拒否できる。もう片方は使える。
4. Mac/サーバーの再起動・切断・証明書更新・期限切れから、認可と台帳を維持して復旧できる。業務通信・印刷に悪影響がない。
5. APIを接続しないモックで上記を先に行い、費用台帳・未確定状態・二重送信防止の維持を確認する。

現在確認済みなのはMac内loopbackのHTTPS表示等であり、WARP/Gateway経由の拒否・失効、WindowsのHTTPS・業務影響は未検証。[現在の接続記録](restricted-trial-plan.md)

## 提案する順序（未承認・未着手）

1. 今回はAの小さな範囲で、2台接続と拒否・失効のモック試験、短い運用手順までを完了させ、現場で使う価値を評価する。
2. 継続する場合、手動証明書更新を避けるAの公開CA化と、Macを起動し続けなくてよくするDを別々に費用・権限・作業量で判断する。
3. VPNクライアントをなくす必要が明確ならC、共用端末の契約適合が確認できればBを再比較する。

今回の依頼は比較と提案まで。上記の設定・実装・実機操作には進んでいない。

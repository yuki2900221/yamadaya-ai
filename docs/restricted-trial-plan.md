# 2端末限定の試用接続案（未実施）

確認日: 2026-10-19。対象はこのMacと会社共用PC 1台（Windows 11 / Chrome）。従業員ごとのログインを要求しない。会社ドメイン `superyamadaya.com` はWix DNSのまま維持する。

本資料は公式仕様の調査と設計案。アカウント作成、契約、端末登録、DNS変更、Tunnel公開、実API呼び出し、秘密情報の読取は実施していない。接続・失効の実機合格報告ではない。

## 推奨判断

ユーザーは2026-10-19に「WARPを2台に入れる方式で進める」を選択した。初回導入と無料枠での接続検証を進め、有料契約が必要なら停止する。Cloudflare管理画面は未ログインだったため、ユーザーが既存の会社管理アカウントでログインする段階。選択の承認と実設定の完了は分けて記録する。

**Cloudflare WARP + private Tunnelを、課金しないモックで先に検証する。** 個人アカウントなしの端末登録が公式に用意され、公開DNSを変更せず、既存MacのNode/SQLite台帳を維持できる。ただしHTTPS、登録した2端末だけの許可、失効後の再登録防止は実機で確認するまで未成立とする。

クライアントソフトの常駐を避け、ブラウザだけで使うことを優先する場合は、**独立した試験ドメイン + Cloudflare Access mTLS + named Tunnel**を代替とする。新規ドメイン取得と有料Accessの契約条件を確定してから承認対象にする。WixのDNS全体移行やBusinessプラン契約を暗黙に含めない。

| 案 | 従業員の操作・既存構成 | 費用・条件 | 判定 |
|---|---|---|---|
| WARP + private Tunnel | 管理者が初回に2端末を登録。以後はChromeで利用。MacのNode/SQLiteを継続。public DNS不要 | Zero Trust Freeは50ユーザー枠。service token登録はseatを消費しない。必要な端末制限機能がFreeで利用できること、申込時に課金設定を要求されないことは管理画面で未確認 | 最初の検証候補。無料で成立すると確定したわけではない |
| 独立試験ドメイン + Access mTLS + named Tunnel | 2端末に別々のクライアント証明書。必要ならChrome証明書自動選択ポリシー。Mac側はloopbackのまま | Access mTLSはpay-as-you-go / Enterprise対象。公開単価は$7/ユーザー/月（年払い表記）。seatの算定、最低契約額、実際の請求額は要確認。ドメイン代は別 | 個人ログイン不要の仕様が明確な有料代替 |
| Tailscale Serve（Funnelは使わない） | private `.ts.net` HTTPS → Macの127.0.0.1。自前DNS不要。2端末限定grantとdevice approvalが必要 | Personalは非商用。Standard $8/ユーザー/月。会社独自ドメインメールで14日Enterprise試用。台数とseat数は同じではない | 共用Windowsのアカウント/契約モデルを未確認。今回は自動採用しない |

料金根拠: [Cloudflare plans](https://www.cloudflare.com/plans/)、[Access価格](https://www.cloudflare.com/sase/products/access/)、[Access mTLS条件](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)、[Tailscale pricing](https://tailscale.com/pricing)。価格はUSD、税・為替を含めない。

Tailscaleのタグは非人間のサーバー等のための機能であり、利用者の端末をタグ化して従業員アカウントを省略する使い方は公式の説明に反する。共用PCをタグ付き端末として1seatで済むとは説明しない。[Tags](https://tailscale.com/docs/features/tags)、[Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)、[Device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval)

## WARP案の具体構成と未解決点

```text
登録したMac / 登録したWindowsのChrome
  → Cloudflare One Client（WARP）
  → Gateway: 指定端末のposture + 試験用hostname/portだけ許可、残り拒否
  → private hostname route / named cloudflared（Macで常駐）
  → Mac内のHTTPS終端（loopback、証明書を2端末で信頼）
  → 127.0.0.1:4174 Node → 既存SQLite台帳 → OpenAI
```

- WARPはservice tokenで利用者の操作なしに登録できる。トークンは端末ごとに分け、管理者だけが初回設定する。利用者IDに基づくルールは適用できないため、許可対象端末を実際のdevice postureで限定する。[登録仕様](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/device-enrollment/)
- private hostnameはcloudflaredホスト側のsystem resolverで解決できる。Mac内だけで試験用名を解決する設計とし、Wixには書き込まない。loopbackへの接続とHTTPS終端はこの構成で未実測。公開証明書を自動取得できるとは仮定せず、内部CAを2端末に限定して信頼させる初回設定まで試験する。[private hostname](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-private-hostname/)
- `Device UUID`はCloudflareの登録IDをそのまま使う機能ではなく、managed deploymentで付与する識別子。手動で登録IDを並べれば完了とはしない。利用可能なserial等のposture条件を選び、無関係な登録端末も拒否する。[Device UUID](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/device-uuid/)、[Network policies](https://developers.cloudflare.com/cloudflare-one/traffic-controls/network-policies/)
- service tokenの登録許可が残ると、登録の削除・失効後に自動再登録し得る。停止時は登録許可を取り除き、既存registrationも失効させる。2端末の初回登録後に新規登録を閉じる運用と、再起動後も利用できることを試験する。[登録・失効](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/device-registration/)
- WARPの経路は試験用通信に限定し、既存業務通信、LAN全体、SSH等を許可しない。公開hostname、Quick Tunnel、公開IPの受信ポートは設けない。

## mTLS案で必要な条件

外向きの名前付きTunnelで `https://試験用ホスト` からMacのloopbackへ接続する。入口はAccessのService Auth + 個別証明書とする。許可CA全体だけでなく端末固有の条件で絞り、Chromeの証明書選択が管理者設定で省略できるか実機で確認する。クライアント秘密鍵をコピーできれば端末限定性は破れるため、OSの保護と非エクスポート設定を確認する。

Wix DNSを維持してCloudflareの公開proxyだけを使うpartial CNAME構成はBusiness / Enterprise、子ゾーンを別Cloudflare zoneへ委任する構成はEnterpriseが必要。このため独立試験ドメインを代替にする。[Partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)、[Subdomain setup](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/)

Access経由では署名・固定したissuer・対象audience・有効期限・nbf・許可algを検証する。端末失効時は証明書拒否と既存セッションの両方を確認する。有効JWTを別端末に移しても使えないことはJWT検証単体では保証できないため、全経路をmTLS入口に閉じ、迂回経路を持たせない。[JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## アプリ側の必要変更と運用

現行サーバーは127.0.0.1接続だけでなくHost/Originもローカル値に限定している。Tunnelを開始するだけでは完成しない。採用した単一HTTPS Originを明示的に許可し、Secure cookie、CSRF検査、信頼するローカルproxy境界を検証する。`0.0.0.0`への変更や任意Host/Origin許可で通さない。Vite開発サーバーを外部に出さずbuild版を使う。

Macは利用時間中の常時起動・給電・ネット接続が必要。Node、HTTPS終端、connectorの停止は利用停止になる。プロセス再起動でSQLiteを消さず、unknownを自動再送しない。OpenAIキーをWindowsやブラウザへ渡さず、Web検索もサーバー経由の記録・予算制限に含める。

Vercelへの移設は今回は最小変更にならない。現在の単一Mac上のSQLite、メモリセッション・結果、ジョブ継続処理を、永続DBと複数実行環境を考慮した構成へ置き換える必要がある。また公開originへの直接アクセス防止を別途試験する。端末接続試験のためだけに台帳移行を行わない。

ユーザーの最新指示で試用期間は**1週間**。アプリ再開許可は2026-10-26 08:47:54 JSTまで反映済み。既存1日APIキー自体は延長されておらず、1週間の利用にはキー更新が必要。この接続案は未実施。**API総額上限$10、unknown 3件の$0.45保留を維持**する。期間延長は予算の増額やunknownの解消を意味しない。

## 公開判定前の試験（すべて未実施）

1. モックのみで、Macと指定WindowsのChromeからHTTPS表示、セッション、全機能の操作を確認する。従業員のログイン画面が出ないことを確認する。
2. 未登録端末、同じLANの端末、WARP停止、無関係な登録端末から拒否されることを確認する。公開URL/IP・別Host・別port・偽造proxyヘッダーの迂回を試す。
3. 対象Windowsを失効させ、開いていたタブ、既存cookie、WARP再接続、OS再起動でも拒否されることを確認する。もう一方の端末は継続利用できることを確認する。
4. 新規登録を閉じた状態で正常端末が再起動後も使え、トークンだけを使った別端末登録が成功しないことを確認する。証明書/端末秘密鍵のコピー耐性と管理者境界を記録する。
5. 切断・タブ終了・Macアプリ再起動後も同じ操作が二重送信されず、unknown・予約額・総額が保持されることをモックで確認する。試用期限と予算の拒否も確認する。
6. Windowsの既存業務サイト、印刷、社内LAN通信への影響がないことを確認する。結果と残る制約を記録後、承認済み範囲内の実API試験へ進む。

WARP方式は選択済み。残る事項は、会社管理アカウントでのログイン、両端末の初回管理者作業、利用できる無料プランと2端末限定設定の実測。料金が発生する場合は契約額と対象を明示してから承認を受ける。既存Wixアカウントの秘密情報は不要。

## Macインストーラーの準備

公式のmacOS 2026.8.2110.0パッケージを一時フォルダへ取得済み。Homebrew公式caskのSHA-256と一致し、pkgutilでCloudflare Inc.のDeveloper ID Installer署名・Apple公証の信頼を確認した。OSインストール、WARP接続、VPN/DNS変更はまだしていない。Windows側は会社PCで初回インストールが必要。配布先は[公式ダウンロード](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/)。

Tunnelコネクターcloudflared 2026.10.1はHomebrewの公式配布から導入し、版を確認済み。Tunnelの作成・ログイン・接続・常駐サービス起動はしていない。MacのWARP自体は管理者認証が必要で未インストール。

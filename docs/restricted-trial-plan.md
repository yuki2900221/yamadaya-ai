# 2端末限定の試用接続計画と進捗

最新: 指定会社メール1件の登録AllowとWindows専用profileを保存確認。One-time PINを追加し、Enrollmentの認証方法をOTPだけに限定、特定tokenのService Authを維持した状態を再読込で確認した。端末番号2件・単一ホスト/TCP8443のGateway制限、モックTunnelとprivate routeは前段で保存済み。Windows本人のコード入力・端末登録、HTTPS信頼・名前解決と接続/拒否/失効の実機検証は未完了。以下は履歴を含み、末尾の追記を優先する。

確認日: 2026-10-19。対象はこのMacと会社共用PC 1台（Windows 11 / Chrome）。従業員ごとのログインを要求しない。会社ドメイン `superyamadaya.com` はWix DNSのまま維持する。

本資料は公式仕様、段階的な設定実施、未実施の試験を区別して記録する。接続・失効の実機合格報告ではない。

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

## 2026-10-19追記: インストール後とFree申込画面の確認

この節は、上のインストーラー準備記録より後の現在状態を記録する。主担当による実画面・端末状態の確認結果を反映した。

- MacのWARPはインストール済み。確認できた版は2026.8.2110。daemonの状態は`RegistrationMissing`であり、会社のZero Trustへの端末登録はまだない。
- Cloudflare管理画面へのログインは済んでいる。Freeプランを選択して申込画面へ移動したが、**subscriptionは未有効化**。
- 実画面ではFreeが`$0 / seat / month`、会社のPoC向け、50ユーザー上限と表示された。支払い画面のOrder summaryもDue Today `$0 / month`だった。
- 同じ画面には、含まれる枠を超えた利用の月次請求に関する表示がある。カード欄は空欄、Termsへの同意と追加利用分の月次請求を認めるチェック欄は未選択。カード入力、同意、Activateには触れていない。`$0`表示だけを根拠に追加機能・超過利用まで無料と解釈しない。
- 今回の確認では実API呼び出し、APIキー変更、料金発生、Tunnel接続、端末認可変更を行っていない。会社のアカウントIDや支払い情報はこの資料に保存しない。

現行公式手順（2026-10-12更新）にも、Zero Trust Freeの申込で支払い情報が必要であり、Freeを選択した場合は課金しない旨が記載されている。これは画面の注文内容・追加利用条件を確認する代わりにはならない。[公式Get started](https://developers.cloudflare.com/cloudflare-one/setup/)

Freeで必要なprivate Tunnel・Gateway・端末チェックを実際に設定できることは、まだ確認できていない。WARPのインストール済み状態、Freeの選択、`$0`の表示だけでは認証方式の成立としない。申込確定前には、秘密値を含まない設定案、ローカルHTTPS/Origin対応、モック試験を準備できる。

### 申込確定後の設定順序（未実施）

1. **まだrouteを追加しない。** Zero Trustの有効プラン、既存端末、enrollment policyを確認する。会社メール全体・Everyone・Any service tokenなどの広い登録許可を新たに設けない。
2. GatewayのTCP proxyを有効にし、試験用宛先・専用virtual networkを対象とするcatch-all **Blockを先に**設定する。SNIが一致する通信だけをBlockする方式にはしない。SNIなし、直接IP、別portも拒否対象にする。会社のインターネット全体をBlockする設定にはしない。
3. 許可するMacとWindowsのserial番号2件だけのリストを作り、`Passed Device Posture Checks`で照合する。試験用hostname/SNI、HTTPSの宛先port、試験用宛先/virtual network、当該postureをすべて満たす**AllowをBlockより上位**へ配置する。欠損・失敗postureは許可しない。
4. 端末別service tokenを作り、その特定tokenだけを`Service Auth`のenrollment policyへ一時的に追加する。管理者がWARPの`organization`、`auth_client_id`、`auth_client_secret`を初回設定する。秘密値はGit、チャット、画面共有資料へ載せない。Postureは登録後に評価されるため、enrollment policy自体に端末チェックがあるとは扱わない。
5. 登録が対象2台だけで、各postureが期待どおりになることを確認し、新規登録の許可を閉じる。正常な再起動・再接続と新たな端末の登録拒否を確認する。失効時はtokenの登録許可と既存registrationの両方を止め、自動再登録を防ぐ。
6. HTTPSとHost/Origin対応を済ませた**モックoriginへのprivate routeを最後に**接続する。Gatewayログで実際の照合先（初期解決IP、実宛先、virtual network）とルール順序を確認し、別端末・直接IP・SNIなし・別port・失効後の拒否を試す。公開hostnameや広いLANのCIDRは追加しない。

この順序は、private Tunnelの初期状態では全登録端末が接続でき、Gateway network policyは上から順に最初の一致で評価される仕様に基づく。[private Tunnelの既定動作](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/)、[network policies](https://developers.cloudflare.com/cloudflare-one/traffic-controls/network-policies/)、[policy例と評価順序](https://developers.cloudflare.com/cloudflare-one/traffic-controls/network-policies/common-policies/)

Serial numbersはmacOS・Windows双方に対応する。**Device UUIDは現行対応表で両OSとも非対応**のため今回の2端末限定には使わない。serial値だけを暗号学的な本人証明とは扱わず、端末登録の鍵、登録許可の閉鎖、Gateway制限、OS管理者境界と組み合わせる。[対応OS表](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/)、[Serial numbers](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/corp-device/)

Service Authには`Allow`とは別のactionが必要で、enrollment policyではposture checkを実行できない。削除・失効だけで登録許可を残すと、自動再登録が起こり得る。[端末登録](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/device-enrollment/)、[管理設定パラメーター](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/mdm-deployment/parameters/)、[登録の失効](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/device-registration/)


## 2026-10-19追記: モックTunnelと2端末の初回登録準備

実画面でZero Trust Free、当初の登録端末0件を確認した。ユーザーが会社Windowsの端末番号を直接入力し、承認済みSerial numbersリストは2件。実値・組織/アカウントID・登録秘密値は公開資料に含めない。WindowsのCloudflare One Client導入はユーザー申告で完了、版・組織登録・接続は未確認。

### 保存・起動したもの

- 端末別Service Tokenを承認後に発行して非公開0600で保存。初回Mac用の秘密値がツール出力へ露出したため、未使用のまま無効化し167時間の交換用へ置換した。Windows用は168時間。無効化した旧tokenを登録許可・profileに含めない。
- 一時的なenrollmentは特定2tokenのみのService Auth。専用profileは当該2tokenに一致し、Traffic and DNS / MASQUE / Include。手動Includeは試用名と組織のteam domainだけの2件で、既定profileとLocal Domain Fallbackは変更していない。adapter IPの業務DNS登録は専用profileでOff。
- Gateway Networkは、単一の試用SNI、TCP、8443番、Cloudflare Tunnel宛、承認済みserialリストの成功をすべて満たすAllowを保存し、全Tunnel宛Blockより上へ移動した。posture欠損、誤SNI、SNIなし、別port/protocolを広いAllowへ落とす構成にしていない。実際の拒否は未測定。
- 試用ホスト完全一致のDo Not Inspectを保存。protocol detectionをOn、全port判定を選択し、TLS decryptionはOffを維持した。HTTP一覧のinactive表示とDNIの保存だけでは暗号化・Gateway認可を実証したことにはしない。
- 承認されたモック専用named Tunnelを作成し、追加許可に基づくクリップボード一時コピーで接続キーを0600ファイルへ保存、内容を消去した。非特権cloudflaredをtoken-fileで起動し、管理画面でHealthy/1 replicaを確認。private hostname routeは `ai-trial.superyamadaya.com` 1件のみ。公開アプリ、CIDR/LAN route、Wix DNS変更はない。

### HTTPSのローカル検査と残件

独立したdemoモード・別台帳を127.0.0.1:8443に起動。新しい試用名でTLS/Host/Origin/Secure cookie/権限拒否を含むローカル8項目に合格し、ジョブ・実API実行は0。明示した試験CAによる検査であり、OSの信頼設定やWindows/WARPを通した成功の代わりにはしない。既存4174番のアプリ、キー、SQLite台帳は変更していない。

既定の`.internal`フォールバックを削除しないため、試用名を会社管理ドメイン配下へ変更した。公開A/AAAAは読取時にENOTFOUND。非特権443番bindがEACCESのため8443番を選び、上記プロトコル判定を追加した。Macのhosts/OS信頼は未変更で、cloudflaredがorigin名を正しく解決する設定が残る。Macからloopbackへ直通する試験を行う場合、Gatewayの接続制限の証拠と分ける。

公式Split Tunnelsは既定initial-resolved範囲をclient runtimeが自動管理すると説明している。手動で追加した重複IPv4指定は削除し、独自範囲の有無と実際のDNS応答/適用経路は接続後に確認する。IncludeはIP転送の制御で、DNSは原則Gatewayへ送られる。通常Web、社内DNS/LAN、印刷の実機影響は未測定。[Split Tunnels](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/split-tunnels/)

### Windowsの受渡方法の変更

ユーザーがUSBを使えないため、**Windowsだけ初回に既存Cloudflare管理者のメール1件でOTP認証する**方式への変更を明示承認した。従業員の通常ログインとは分ける。メール全体・Everyoneは許可せず、2台を確認後にメール/tokenの新規登録許可を閉じる。Windowsの専用Include profileを下記のとおり保存後、初回登録だけを案内した。接続スイッチはOffのまま登録結果を確認する。準備したWindows用秘密XML/ヘルパーは未配布・未実行。

公式上、既存registrationはenrollment許可の閉鎖だけでは削除されず、Gatewayのclient session durationを強制しない場合は日次ログインを要求しない。実機の再起動・1週間の継続は未確認。ログアウト/再インストール等で新規登録が必要になれば管理者が再設定する。1週間後はアプリの期限停止に加えて、Gateway/registrationの停止も必要である。[Device registration](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/device-registration/)、[Client sessions](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/client-sessions/)

ローカル初回設定用ヘルパーは、既存MDM上書き拒否、準備marker、秘密の非表示と権限制限を備えた案を作成し、独立レビューで親directory ACLとmarker更新順の修正を進めた。Windowsでの実行やACL実測はしていない。既存の別組織登録があれば、MDMファイル不在でも自動変更せず停止する。

残件: Macの初回管理者設定、両端末の正しい組織登録、証明書信頼・origin名前解決、実際のAllow/Blockログ照合、登録閉鎖・失効と再登録拒否、基本4機能のWindows操作・既存業務通信の確認。接続準備の保存を2台限定の実証済みとは扱わない。今回実API0、追加入金/有料追加機能なし。$10上限・unknown3件$0.45・元の試用期限は維持し、既存OpenAIキーの期限更新も未実施。


### Windows初回登録の案内時点

管理者メール1件のAllow enrollment policyを保存し、`Enrollment policy saved successfully`を確認した。Mac用のprofileへOR/AND条件を追加する案は、OS条件がMacを除外し得るとして自動承認レビューが保存を拒否した。未保存変更を取り消し、元のMac用Service Token条件を保持したことを確認した。

代わりに独立した`Yamadaya trial - Windows app only`を既存限定profileから複製。条件は管理者メールの完全一致 **AND** Windowsのみで保存した。Includeは試用名とteam domainの2件、adapter DNS登録Off、auto-connect Offを保持。保存後のdetails画面で条件・転送先を確認した。元のMac用profileとDefaultにはWindows条件を適用していない。適用端末数は0で、実際に適用されるprofileは登録後に照合する。

ユーザーへWindowsのZero Trust初回登録手順を案内した。コードをチャットへ送らず、別組織に登録済みなら停止、登録後も接続はOffのまま結果を知らせてもらう段階。接続・信頼・実機試験の合格ではない。


### 会社管理メールへの変更（受領前の履歴）

ユーザーが会社共用PCで私用Googleアカウントを使いたくないと明示。GoogleへのログインとWARPのOTP登録は別だが、登録情報へ私用メールが残る点を説明し、会社管理メールを使う方式へ変更することを選択した。私用メールのenrollment policyを適用対象から外し、Enrollment policy saved successfullyを確認。特定tokenのService Authだけを保持している。会社アドレス自体は未受領で、メール許可とWindows用profileのアドレス更新は未実施。直前のWindows登録案内はいったん停止し、旧私用メールで登録しない。

### 会社管理メールとOTPの設定完了（最新）

指定会社メール1件だけのInclude Emails / Allowを保存し、Enrollmentへ適用した。Windows専用profileも同じメールの完全一致AND Windowsへ更新し、保存後のdetailsで確認。Includeの2宛先、auto-connect Off、adapter DNS登録Offを保持した。Mac用profileとDefaultは変更していない。実メールは本書・GitHubに記載しない。

調査時のIdPはCloudflareだけだった。これはCloudflareアカウントによる認証で、OTPの別名ではない。従来の案内は「メール許可があればOTPを利用できる」という前提が不足していた。現在の新規組織ではCloudflare IdPが既定となり、OTPは自動追加されない。[公式Cloudflare IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/)、[公式One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

Access Applicationsが初回作成画面で既存アプリを表示しないことを確認してから、One-time PINを追加し、ADDED表示を確認。EnrollmentはAccept all available identity providersをOff、選択をOne-time PINだけ、instant authentication Onで保存した。ページ再読込で、この選択と会社メールAllow・特定2 tokenのService Authの保持を確認した。OTPを独立したInclude条件として追加していない。会社メールにCloudflareアカウントの作成や管理権限は付与していない。

Windowsでは403の古いタブを閉じ、WARPアプリからチーム名を入力する初回登録をやり直す。指定メールでコードを受け取り、本人がWindows画面へ入力する。裸の`/warp` URLや古い認証URLの再利用を案内しない。登録後は接続Offのまま端末・適用profile・postureを管理側で照合する。403画像だけから個別リクエストの拒否原因を断定せず、登録成功は実際の結果待ちとする。

今回の実測は管理画面の保存・再読込確認のみ。Windows登録・接続/拒否/失効、証明書信頼、名前解決、11項目の実機試験は未実施。実API0、追加契約・入金・Wix DNS変更なし。既存アプリ・台帳・キー・$10上限・unknown3件$0.45・元の試用期限を維持した。

# Windows 11 / Chrome 初回設定チェックリスト（案）

更新日: 2026-10-19（日本時間）。会社共用PC 1台を対象とする、管理者向けの準備資料。**Windowsの組織登録・接続・下記実機試験は未実施**。Windowsの最新登録方式は、下記の初回管理者OTP方式を優先する。組織名と証明書の確認方法は、設定の準備が完了してから個別に案内する。

要求・許可範囲は[試用版要求](requirements.md)、全体構成と最新状態は[2端末限定試用計画](restricted-trial-plan.md)、費用と期間は[最新報告](all-features-week-trial.md)を正本とする。本書は現地作業と実機の合否記録に限る。

## 最新の登録方式と準備状況

- USBを利用できないため、**Windowsの初回登録だけ、既存のCloudflare管理者メール1件へのOTPで本人が認証する方式をユーザーが明示承認**した。主担当が一時的なenrollment policyを保存し、保存成功の表示を確認した。メールアドレス・OTP・組織名の実値は本書へ記載しない。
- Gatewayは、許可リストのシリアル番号2件・試験用単一ホスト・TCP 8443だけのAllowと、その下位のTunnel Blockを保存し、順序を確認済み。モック用TunnelはHealthy、private hostnameのrouteは1件追加済み。これらは管理側の設定確認であり、Windowsからの到達・拒否を実測した結果ではない。
- **Windows用のInclude profileは準備中で未完了**。適用先・経路を確認するまでWindowsの組織登録と利用開始へ進めない。会社PCの既存の組織登録・管理設定を先に確認する。
- Windows用の登録helperとXMLは**未配布・未実行で、配布案は保留**。Windowsでは秘密値を渡す旧手順を進めない。
- 通常の従業員ログイン不要は維持する。公式には、Gatewayのclient session期限を指定しなければ既定で無期限となるため、初回登録と毎日のログインは分けて扱える。実際の再認証設定の確認と、Windowsの再起動・再接続試験は未実施。[公式Client sessions](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/client-sessions/)
- 対象2台の登録・postureを照合したら、メールとTokenによる新規登録許可を閉じる。登録許可の閉鎖後も両端末を再起動して確認する。登録状態は削除まで持続する公式仕様だが、実機の再接続成功を先取りしない。[公式Device registration](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/device-registration/)

## 前段の準備記録（登録方式は上記を優先）

- ユーザーが会社PCのシリアル番号をCloudflareへ直接入力し、主担当がリスト件数2件を確認した。実値は本書に記録していない。Windows実機が報告するpostureとの一致は未確認。
- Mac用・Windows用の登録用Service Tokenは承認後に発行済みで、有効期間はそれぞれ167時間・168時間。秘密値は権限0600の非公開ファイルに保存されている。ツール出力へ露出した当初の未使用Mac用tokenは無効化し、交換済み。token発行は端末登録や接続の成功を意味しない。名前・値・受渡方法は本書へ記載しない。
- モックURLは`https://ai-trial.superyamadaya.com:8443/`。既定のLocal Domain Fallbackに`internal`が含まれるため、従来案の名前を使うために業務向けのDNSフォールバックを削除しない方針とした。[公式Local Domain Fallback](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/local-domains/)
- 主担当が新候補の公開A/AAAAを読み取り確認し、`ENOTFOUND`だった。Wixや公開DNSは書き換えていない。会社管理ドメイン下の名前をprivate経路に使う予定であり、一般公開URLの開通ではない。
- 新しい名前を対象にしたローカルモックTLS試験は8/8件合格。従来案での8件合格は履歴として区別する。OSの証明書信頼・hosts・WARPの変更はまだなく、WindowsからのHTTPS接続の証拠にはしない。
- 会社WindowsのWARPは**インストールできたとのユーザー申告を受領**。実機の版、会社組織への登録、接続状態はまだ確認していない。以下の実機試験もすべて未実施。
- 試用専用の端末profileを新規作成し、対象を発行済みの2つのService Tokenに限定して、Split TunnelsをInclude方式へ切り替えた。試験用の単一ホストと組織のteam domainを対象に設定中で、保存後の内容・適用の検証は未完了。既定profileとLocal Domain Fallbackは変更していない。設定画面の操作を、Windowsへ適用済みの証拠にはしない。
- Macで非特権の443番待受が`EACCES`になったため、8443番を計画中。Gatewayの全ポートでのプロトコル検出と、当該ホストだけのTLS復号除外の設定・検証が残る。ポートやホストを広げて回避しない。最新の設定・試験結果は[接続計画](restricted-trial-plan.md)へ集約する。

## 作業前

- [ ] 会社が指定したWindows 11 / Chromeの共用PC 1台であることを管理者が確認する。Windows、Chrome、既存VPN、業務サイト、社内LAN、印刷の現在の動作を控える。
- [ ] 初回だけWindowsの管理者が作業できる時間を確保する。従業員へCloudflare管理権限、OpenAIキー、登録用秘密値を渡さない。
- [x] 会社WindowsへCloudflare One Client（旧WARP）をインストールしたとのユーザー申告を受領した。重ねて再インストールせず、次に版と登録先を確認する。
- [ ] 管理者が導入済みの版・発行元を確認する。[公式ダウンロード](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/)ではWindows 11が対応対象。既存の会社VPN・DNS・証明書設定は削除しない。既存通信との競合が出た場合は先へ進めず管理者へ戻す。
- [ ] **初回登録の手順を実行する前に、WARP画面等で既存の会社用組織への登録や管理設定がないことを確認する。** 設定ファイルが存在しなくても、手動で別組織へ登録済みの場合がある。既存の組織登録・管理設定があれば実行せず管理者へ戻し、ログアウト・登録削除・上書きで進めない。

## 端末番号の登録

リストへの入力はユーザーが実施済み。実機とpostureを照合する場合は、管理者が対象Windows上のPowerShellで、読み取り専用の次のコマンドを実行する。

```powershell
Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber
```

- [ ] 表示されたシリアル番号を管理者が会社PCの識別情報と照合する。空欄・汎用値・重複などで1台を識別できなければ許可リストに追加せず、代替の端末識別を検証する。
- [x] ユーザーが値をCloudflareの試験用「Serial numbers」リストへ直接入力し、主担当が件数2件を確認した。**公開チャット、GitHub、公開スクリーンショットには実値を記録しない**。
- [ ] 登録後、Windowsのpostureが当該リストに一致することをCloudflare管理画面とログで確認する。シリアル番号は暗号学的な端末証明ではなく、OS管理者による改変等に対する限界を残す。[公式のシリアル番号手順](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/corp-device/)

## 組織への初回登録（Windowsは初回管理者OTP）

- [x] 管理者側で、対象2件のシリアル番号・単一ホスト・TCP 8443だけのAllowと、その下位のTunnel Blockを保存して順序を確認した。組織へ登録できることとアプリに接続できることは別に実機検証する。
- [ ] Windows用Include profileの準備・保存・適用先の確認が完了していることを管理者が確認する。
- [ ] 既存の会社用組織登録がないことを確認後、管理者が承認済みメール1件のOTPで初回登録する。コードをチャットや従業員へ渡さない。helper/XMLの配布やService Tokenの手入力で進めない。
- [ ] Cloudflare One Clientが会社の正しいZero Trust組織へ登録されたことを管理者が照合する。一般向けの1.1.1.1接続だけでは完了にしない。
- [ ] Cloudflare管理画面の対象登録とpostureをWindows実機と照合し、対象がMacとWindowsの2台だけであることを確認する。2台登録後はメール・Tokenの新規登録許可を閉じ、再起動・再接続の正常動作を試す。

posture検査は登録後に行われ、登録許可そのものでは利用できない。OTPで登録できることを2端末限定の接続許可の代わりにはしない。旧Service Token方式の公式要件は前段の参考資料として保持する。[登録許可](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/device-enrollment/)・[管理設定パラメーター](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/mdm-deployment/parameters/)

## 最初はダミーの画面で試す

試験用URLと正しい証明書の確認方法が案内されるまで、アプリの実AIを接続しない。Chromeの証明書警告を無視したり、`--ignore-certificate-errors`や安全機能を無効化する設定で通したりしない。証明書の信頼登録が必要なら、対象ホスト・証明書指紋・用途と削除方法を先に確定する。当該試験用HTTPSホストの通信にはGatewayのTLS復号を適用しない。プロトコル検出や復号除外の設定が既存業務に与える影響も確認する。

以下は予定する合格条件であり、現時点ですべて未実施。試験は有料APIを使わないモックで行う。時刻、端末の別名、操作、期待値、実測、照合したルールを非公開で記録し、秘密値や実際の端末番号を公開報告へ転記しない。

| ID | 実機操作・確認 | 合格条件 | 現状 |
|---|---|---|---|
| WIN-01 | 指定WindowsとMacで試験用HTTPS URLをChromeで開く | 両方で警告なく表示。用意した宛先の証明書であり、従業員の個人ログインなしでモックを使える | 未実施 |
| WIN-02 | 未登録の別端末から同じURLへ接続 | アプリへ到達できない。ブラウザだけでなくGateway/経路側の拒否根拠も確認する | 未実施 |
| WIN-03 | 指定WindowsでWARP停止後、新しい接続を作る | 試験用アプリへ接続できない。同じ会社LANからの直通経路もない | 未実施 |
| WIN-04 | 管理者が用意した未許可の登録端末を使う | 組織に登録済みでもposture不一致なら拒否。陰性試験用の追加登録は対象・削除を明示した隔離手順で行う | 未実施 |
| WIN-05 | 直接IP、別Host/SNI、SNIなし、別ポート、公開候補経路を管理者が試す | 許可した単一HTTPS宛先・ポート以外ではモック/APIに到達できない。証明書エラーだけを認可拒否の証拠にしない | 未実施 |
| WIN-06 | Windowsの登録許可を閉じてregistrationを失効。既存タブ、Cookie、再接続、再起動で確認 | 新規送信・新たな結果取得が拒否され、実測した失効時間を記録。Macは利用を継続できる。表示済み内容や保存済みファイルまで消えるとは扱わない | 未実施 |
| WIN-07 | 新規登録を閉じた状態で、正常な両端末を再起動 | 既存登録で接続でき、新しい未許可登録はできない。再登録を広く許可して直さない | 未実施 |
| WIN-08 | ダミーのチャット・POP・画像・文章、コピー、保存、POP PDF、利用終了を操作 | 全基本機能のモックが動き、終了後は前利用者の内容・結果を取得できない。ChromeのコピーとダウンロードをWindows上で実確認 | 未実施 |
| WIN-09 | 二重クリック、切断、タブ終了、配信元再起動をモックで試す | 同じ操作の送信は1回。未確定・予約額を保持し、自動再送しない | 未実施 |
| WIN-10 | 通常の業務サイト、社内LAN、既存VPN、印刷を変更前と比較 | 既存業務を妨げない。経路・DNS変更が及ぶ範囲を記録する | 未実施 |
| WIN-11 | Macの配信停止・スリープ・通信断を試す | 接続不能を利用者が認識できる。一般公開等の迂回へ自動切替しない。復帰後も台帳を保持 | 未実施 |

private Tunnelは初期状態で全登録端末が到達できるため、接続成功だけでは2端末限定の証拠にならない。Gatewayの拒否と許可を確認する。[private Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/)・[Network policies](https://developers.cloudflare.com/cloudflare-one/traffic-controls/network-policies/)

登録削除だけで再登録が可能な状態を残さない。失効試験・紛失時は登録に使った許可とregistrationを併せて停止し、ログで確認する。[Device registration](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/device-registration/)

## 現地確認が終わるまでの判定

このMacからWindowsの接続、Chromeの信頼状態、起動後の無操作利用、印刷、既存業務への影響を実測したことにはできない。Windows担当者による実機操作と、管理側ログの時刻・ルール照合を合わせて判定する。未許可登録端末の陰性試験等を用意できない項目は「未実施」のまま残す。

上記を通過してから、承認済み期間・残予算内の実AI接続を別途確認する。OpenAIキーはMacのサーバー専用で、Windowsへコピーしない。費用枠・未確定保留・APIキー有効期限は[最新報告](all-features-week-trial.md)を参照する。Cloudflareの有効化とAPIキーの期限延長は別の作業である。

公式資料の確認日: 2026-10-19。組織名・秘密値・端末番号・証明書の実値は未記入。新URLでのローカル8件合格、管理画面の設定操作、Windowsへのインストールのユーザー申告は別の証拠として記録し、上のWindows実機試験を合格へ変更する根拠にはしない。


### 初回登録案内時点の更新

Windows用Include profileを独立作成して保存後のdetailsで確認した。条件は承認済み管理者メールの完全一致AND Windowsだけ。転送先は試用名とteam domainの2件、adapter DNS登録とauto-connectはOff。Mac用profileの共通条件変更は自動レビューがMac除外の可能性を指摘して保存を拒否したため取り消し、別profileに分けて対処した。登録・接続の実証ではない。

会社WindowsでOne ClientのZero Trust securityを選び、個別案内されたteam名と管理者メールで初回認証する手順をユーザーへ案内済み。認証コードはチャットへ送らず、別組織に登録済みなら停止。登録後は接続Offのまま管理側で端末とprofileを照合する。実登録の結果待ちであり、上の実機項目は未実施を維持する。[公式の手動登録](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/)


### 会社管理メールへの変更（最新）

会社PCに私用Googleアカウントを使わない方針を受け、会社管理メールによる初回OTPへ変更する。私用メールの一時登録許可は適用対象から削除・保存確認済み。会社アドレスを受け取るまでWindows登録は停止。先の私用メールによる手順を実行せず、更新後の個別案内を待つ。Googleのログイン状態を会社PCへ作ることは求めない。会社アドレスも公開文書には記入しない。

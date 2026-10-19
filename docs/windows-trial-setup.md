# Windows 11 / Chrome 初回設定チェックリスト（案）

更新日: 2026-10-19（日本時間）。会社共用PC 1台を対象とする、管理者向けの準備資料。**Windowsの組織登録は管理画面で照合済み。接続はOffで、経路・HTTPS等の実機11項目は未実施**。Windowsの登録方式は初回管理者OTP。組織名と証明書の確認方法は個別に案内し、実値を公開しない。

要求・許可範囲は[試用版要求](requirements.md)、全体構成と最新状態は[2端末限定試用計画](restricted-trial-plan.md)、費用と期間は[最新報告](all-features-week-trial.md)を正本とする。本書は現地作業と実機の合否記録に限る。

Mac・Windowsの2端末登録を照合済み。Macは本人のHTTPS初回準備後、OS信頼・loopback名前解決・Chromeでの警告なし表示と接続/証明書の有効表示まで確認した。Windowsは公開証明書の未配布・未信頼登録・接続Offを維持する。現在の判定は末尾の「MacのChrome接続確認」を優先する。

2端末の登録とserial判定の表示記録を照合後、新規登録口をBlock Everyoneだけへ保存・再読込確認済み。既存Mac登録の保持とOffもCLI確認した。Windowsの再接続や新規端末拒否を実測した証拠にはしない。

## 最新の登録方式と準備状況

- USBを利用できないため、**Windowsの初回登録だけ、ユーザーが指定した会社管理メール1件へのOTPで本人が認証する方式を承認済み**。主担当が当該1件のAllow policy保存とEnrollmentへの適用、OTP追加と認証方法の限定を確認した。メールアドレス・OTP・組織名の実値は本書へ記載しない。
- Gatewayは、許可リストのシリアル番号2件・試験用単一ホスト・TCP 8443だけのAllowと、その下位のTunnel Blockを保存し、順序を確認済み。モック用TunnelはHealthy、private hostnameのrouteは1件追加済み。これらは管理側の設定確認であり、Windowsからの到達・拒否を実測した結果ではない。
- Windows専用Include profileは、指定会社メールの完全一致AND Windowsを保持。管理画面で対象1台とLast active profileの一致を照合した。これは最後に取得された設定の証拠であり、接続後の適用・経路の合格とは区別する。
- Windows用の登録helperとXMLは**未配布・未実行で、配布案は保留**。Windowsでは秘密値を渡す旧手順を進めない。
- 通常の従業員ログイン不要は維持する。公式には、Gatewayのclient session期限を指定しなければ既定で無期限となるため、初回登録と毎日のログインは分けて扱える。実際の再認証設定の確認と、Windowsの再起動・再接続試験は未実施。[公式Client sessions](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/client-sessions/)
- MacとWindowsの2端末が一覧にあり、各registration 1件と専用Last active profileの一致を確認した。新規登録口はBlock Everyoneだけを保存・再読込確認済み。閉鎖後の両端末の再起動・再接続と、新規端末の拒否は実測が残る。登録状態は削除まで持続する公式仕様だが、実機の再接続成功を先取りしない。[公式Device registration](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/device-registration/)

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
- [x] 登録後、管理画面で許可端末リストのpostureがPassed（最終実行2026-10-19 11:12 JST）と表示されることを確認した。接続後の更新は別途再確認する。シリアル番号は暗号学的な端末証明ではなく、OS管理者による改変等に対する限界を残す。[公式のシリアル番号手順](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/corp-device/)

## 組織への初回登録（Windowsは初回管理者OTP）

- [x] 管理者側で、対象2件のシリアル番号・単一ホスト・TCP 8443だけのAllowと、その下位のTunnel Blockを保存して順序を確認した。組織へ登録できることとアプリに接続できることは別に実機検証する。
- [x] Windows用Include profileの指定会社メール完全一致AND Windows条件と、対象端末1台・Last active profileの一致を管理画面で確認した。接続後の設定取得・適用は再確認する。
- [x] Access Applicationsの初回作成画面を確認後One-time PINを追加。Enrollmentは全IdP許可Off・OTPだけ・instant authentication Onとして保存し、再読込で確認。既存の特定token Service Authを保持した。
- [x] ユーザーが指定会社メールによる初回登録完了と接続Offを申告した。コード共有、helper/XMLの配布やService Tokenの手入力は行っていない。
- [x] 主担当が会社の管理画面でWindowsの登録1件・active registration 1件・指定メール一致を照合し、Client Disconnectedを確認した。一般向け1.1.1.1の接続表示を根拠にはしていない。
- [x] 管理画面でMac・Windowsの2端末・各registration 1件とserial判定の表示を照合し、新規登録口をBlock Everyoneだけへ保存・再読込確認した。
- [ ] 新規登録許可の閉鎖後、両端末の再起動・再接続と、新しい端末の登録拒否を実機で確認する。

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


### 会社管理メールへの変更（受領前の履歴）

会社PCに私用Googleアカウントを使わない方針を受け、会社管理メールによる初回OTPへ変更した。私用メールの一時登録許可は適用対象から削除・保存確認済み。この時点では会社アドレスが未受領でWindows登録を止めていた。会社PCにGoogleのログイン状態を作ることは求めず、メール実値も公開文書には記入しない。

### 指定済み会社管理メールへの切替（登録前の履歴）

ユーザーが指定した会社管理メール1件のAllow policy保存・Enrollmentへの適用と、Windows専用profileのメール完全一致AND Windows条件への更新を、主担当が管理画面で確認した。

調査時のIdentity providerはCloudflareだけだった。公式仕様でも新しいZero Trust組織はCloudflareが既定で、OTPは自動追加されない。既存Accessアプリを表示しない初回作成画面を確認し、One-time PINを追加、Enrollmentの全IdP許可Off・OTPだけの選択を保存後の再読込で確認した。[公式One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

Windowsで403の古いタブを閉じ、WARPアプリからチーム名を入力して登録をやり直す。指定メールでコードを受信し、本人がWindowsの登録画面へ入力する。GoogleやCloudflare管理画面へのログイン、OTPのチャット共有は不要。完了したら接続Offのまま、管理側で端末・適用profile・postureを照合する。

この時点ではWindowsの登録結果待ちだった。後続の照合結果を次節へ記録する。メール、秘密値、シリアル番号、画面内の接続識別情報は公開しない。

### Windows登録と最後に取得された設定の照合（11:14時点の記録）

2026-10-19 11:14 JST頃、ユーザーの「登録できた・接続Off」との申告後、主担当がCloudflareの管理画面を読み取り確認した。端末一覧はWindows 1台、active registration 1件で、指定会社メールと一致。Platformはwindows、OSは10.0.22631 / UBR 6199、clientは2026.8.2110、Client Disconnectedだった。Macの登録は一覧にない。

Last active profileはWindows専用profileと一致し、profileのdetailsでもEnabled・対象1台を確認した。同profileの管理側設定はTraffic + DNS / MASQUE / Include、auto-connect Disabled、interface DNS registration Disabled。Includeの宛先は単一試用ホストとteam domainの計2件で、会社メールの完全一致AND Windows条件を保持している。端末側CLIによる現在設定の照合はまだ行っていない。

許可端末リスト（既存のシリアル番号2件）のpostureはPassed、Last runは11:12 JST、Connected policiesは1と表示された。これはその時点の登録・設定取得・posture表示の証拠であり、接続Off中の継続更新やGateway経路の合格を示さない。接続開始後にprofileの取得・postureの更新・対応するGatewayログを再確認し、HTTPS表示、拒否・失効、再起動等の実機11項目を試す必要がある。

対象2台が揃っていないため、新規登録許可は未閉鎖。今回の作業ではWeb設定変更・実API呼び出しは0件。登録の照合を理由に、実機11項目の未実施判定は変更しない。実際のメール、端末名・ID、シリアル番号等は記載しない。

### Mac登録とHTTPS用証明書の準備（前段の記録）

ユーザーの明示許可後、Mac本人が登録helperを実行。主担当がCLIで会社組織への登録成功とDisconnectedManual、macOS 27.0.1 / client 2026.8.2110を確認した。取得したprofileは予定のMac専用profileと一致し、warp+doh / MASQUE / Include、always_on false、interface DNS false、Include宛先2件を照合した。管理画面でもMac・Windowsの2端末、各registration 1件、各専用Last active profileの一致を確認した。Windowsの接続Offと、実機11項目の未実施判定は維持する。

HTTPSは、今回確認したChromeポリシーがString形式を扱えなかったため、CA全体を信頼させる旧案を進めず、**7日有効・自己署名・CA:false・serverAuth・単一試用ホストだけのSANを持つleaf証明書1枚を直接信頼する案**へ切り替えて準備している。配布候補は公開証明書だけで、秘密鍵は渡さない。Windows向けの証明書配布・信頼登録は未実施で、Windows Chromeが適切に検証できることも未確認。配布・登録の具体手順は、その確認前に先取りしない。

旧CA方式の証明書は履歴として保存。Macのloopback上のモック8443番を新leafへ切り替えて再起動し、ローカルTLS試験8/8件に合格した。追加実API呼び出しは0件。この合格はOSの信頼設定やWARP実経路を使うHTTPS表示の証拠ではない。

この時点では、レビュー済みのMac用HTTPS初回helperを本人へ手元実行依頼中だった。Windowsへの公開証明書配布・信頼登録・Chrome試験は残件とする。実際のメール、登録ID、シリアル番号、秘密鍵、端末固有のホスト名等は本書へ記載しない。

### MacのOS信頼・名前解決の確認（前段の記録）

ユーザーがMacのHTTPS初回準備完了を申告後、主担当が読み取り確認した。Macの試用ホストは127.0.0.1へ解決し、hostsバックアップはroot所有・権限0600で存在する。macOSの通常の信頼設定を使う証明書検査では、正しい試用ホストがexit 0、別ホストがexit 1となり、ホスト一致を維持したOS側の検証を確認した。

これはMacのOS信頼とローカルの名前解決の証拠であり、Chrome/IABの実ブラウザ表示やWARP経路の合格とはしない。主担当による実ブラウザ操作はこれから。Windowsは接続Offで、公開証明書の配布・信頼登録・Chrome試験はいずれも未実施。Windows実機11項目もすべて未実施のまま維持する。

新規登録口のBlock Everyoneだけの保存・再読込確認と、2端末・各registration 1件は前段で確認済み。今回の確認で実API呼び出し・追加課金はなく、メール・ID・シリアル番号等の実値は記載しない。

### MacのChrome接続確認（最新）

主担当がChromeでHTTPSのホームと基本4機能の各入力画面を警告なしに表示した。Chrome本体の対象ホストのサイト情報で「この接続は保護されています」「証明書は有効です」を確認。生成・送信は行わず、追加API/課金0。検証後もMac WARPはDisconnected/Manualだった。

Macは名前解決がloopbackのため、今回の合格をWindowsやGateway経由の接続合格へ流用しない。WindowsはOffのまま、公開leafの配布・信頼登録・Chrome試験と実機11項目は未実施を維持する。[詳細](restricted-trial-plan.md#macのchrome接続確認最新)

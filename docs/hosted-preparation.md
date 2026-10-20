# Vercel＋Supabaseへの公開準備（2026-10-19）

**2026-10-20 最新：[/goalでMacローカル受入を完了](mac-local-acceptance-20261020.md)。認証ストア待機中のproof期限・端末照会中の登録期限・期限切れ後の終了を修正し、自動284/284・skip0、架空2端末の隔離／片側停止とChromeの基本4機能・下書き4復元・4PDF保存を確認した。最終の隔離build／秘密検査も成功。修正版のクラウド配備は未実施、実接続安定性／Windowsは残る。実AI0・実台帳未読取／未変更。以下は先行する実環境／ローカル確認の履歴。**

**2026-10-20最新：Windowsは本人が操作できないため保留。MacのDB端末停止で既存タブの通信拒否を実確認し、元の権限・期限へ復元後、ホームの再表示も確認した。終了失敗時のローカル入力残存を再現し、修正をローカルで検証済み（自動258件、実ブラウザ）。修正のクラウド配備は未実施、再起動後の安定性・Windows/2台受入は残る。実AI未接続。** 配信方針の正本は親案件の `docs/decisions/ADR-0014-hosted-shared-trial.md`。公開リポジトリの[試用要件](requirements.md)と本報告も参照する。Mac配信の旧WARP/Tunnel案より、ユーザーが後から選んだVercel＋Supabase方針を優先する。元のローカルサーバーと実台帳は置換していない。

## Windows保留中の停止・復元試験とローカル修正（2026-10-20）

本人は会社PCを今は確認できないため、Windowsの作業は保留とした。既に許可された専用モックの接続試験として、Macの一時停止・元状態への復元と、共用画面の終了処理を検証した。Windowsの鍵/CSR/証明書や新しい資格情報は作成していない。手順は[管理者運用手順](device-operations.md)と[段階別Windows手順](../tools/device-cert/README.md#windows)へ整理した。

### 実環境での端末状態の停止・復元

専用projectの表示名と`pgcvetybmtvojpivfjdm`のURLを照合し、既存クエリを上書きせず別のSQL Editorタブで実行した。対象は`yamadaya_mock.devices`のMac1行、変更列は`status`だけ。指紋・`not_before=1792461381324`・`not_after=1792972074000`、owner/role/RLS・予算/jobsの事前後条件を固定し、期間延長・予算初期化・権限追加を行わないSQLとした。SQLは事前のPGlite/PostgreSQL18.6で実ファイル3/3合格、実DBでは17.11で実行成功を別に確認した。

| 試験 | 結果 |
|---|---|
| 停止 | `active → revoked`だけを更新。DB結果は元の日時一致=true、jobs=0、imported=false、paused=true。sessions/noncesは削除せず、SQLトランザクション内で件数不変を検査 |
| 既存タブ | 未送信のダミー入力を持った既存タブで利用終了APIを試し、拒否された。別タブの`/api/session`も`DEVICE_REVOKED`/`notDispatched:true`。WAF由来の403と区別し、既存証明書/ブラウザでもアプリ側の端末停止が効いたと判断 |
| 復元 | `revoked → active`だけを元の登録値・元期限で実行。DB結果と独立した最小web roleの厳格TLS/CA付きread-only照合で、元の指紋/日時・jobs=0・未import/paused維持を確認 |
| ブラウザ再接続 | 復元直後はHTMLの「読み込み中」で停止し、CSS未読込も観測。後の明示的な再読み込みで同じChromeのホーム/操作見本が表示された。復元後の再表示成功と、初回の読込失敗・従前の不安定性を両方記録し、常に無操作で復旧する合格とはしない |

これは**アプリDBの端末状態による次の要求の拒否・元状態への復元**の試験。Cloudflare証明書の不可逆な失効、終了期限の実時間確認、他の1台への無影響、既存ダウンロードの回収の試験ではない。制御された一時停止のためsessionsを残しており、漏洩端末を本停止する際のセッション破棄・証明書失効手順とは分ける。

非公開SQLは`/private/tmp/yamadaya-mac-device-disable-20261020.sql`（SHA-256 `c8458089baec7a023d57bc8adeea7109beed3c61900a8941074bca833f27f2ee`）と`yamadaya-mac-device-restore-20261020.sql`（`7d4b6be013276e329111d54affaf0eeda1b571f35f0bbbce0baeba3e4467a161`）。実値を含むため公開ソースへ追加しない。独立照合は`.runtime/hosted-mock/device-after-restore-verification-20261020.json`。補助curl診断は鍵読み込み方式の不一致とSecureTransport試行のtimeoutで成立せず、接続成功へ数えない。秘密鍵を書き出して迂回していない。

### 見つかった不具合とローカル修正

旧クラウド画面で、端末停止中の`/api/end`が拒否されると終了処理がreturnし、ダミー入力が画面に残る不具合を実際に再現した。また、未import・jobs=0で準備停止中のモックが一律「費用が未確定」と表示されていた。

- `hosted/app.mjs`に停止理由コードを追加し、元の送信停止booleanは維持。未import/期限/一般停止と、原因が確認できる場合だけ費用未確定を区別。承認済みunknownが残る`paused=false`は新たに止めない。
- `src/api.js`で認証エラーのstatus/codeを保持し、終了のHTTP成功だけでなく`ended:true`を要求。
- `src/session-lifecycle.js`と`main.jsx`で、終了押下時に入力/会話/画像を即座に破棄し、遅れた結果・接続情報が再表示されないよう世代で判定。終了未確認時はフラグと操作UUIDだけを保持し、新規送信/前の結果取得を止める。再読み込み時の非課金session/end確認は1回とし、失敗後は手動再確認へ止める。費用台帳や未確定予約を消去しない。
- 終了フラグ保存時の`QuotaExceededError`/`SecurityError`でも、メモリ上のロックと後続の画面消去を継続する。保存失敗時だけ再読み込み後の持続を保証できない旨を表示し、操作UUIDはサーバーの終了確認まで残す。

最終の自動試験は**258/258合格、失敗0、skip0**（約9.44秒）。追加14件を含む件数で、SQL3件やブラウザ試験と合算しない。非公開ログは`/private/tmp/yamadaya-session-safety-storage-tests-20261020.log`。ストレージ保存例外2件の追加後のVite buildは`/private/tmp/yamadaya-session-storage-review-build`へ出力して成功。実ブラウザ試験には先行する同じ正常系のbuild `/private/tmp/yamadaya-session-review-final`を使用し、保存例外そのものは自動試験だけで確認した。既存配信distやサーバーを置換していない。

ローカル実ブラウザは127.0.0.1:4183だけの使い捨てPGlite・合成端末・固定モックで検証。実秘密/実台帳を開かず、実AIを使わない。終了APIを403にした場合、チャット/文章/POPの未送信入力が消え、textarea=0、新規操作/結果取得不可、再読込後も終了未確認を維持した。終了応答を通信切断した場合も、固定のモック画像1件・保存リンク・入力が消え、再読込後も制限を維持。手動再確認で`ended:true`を受け取った後だけ、空の新しい利用へ復帰した。準備中の表示も正しい文章になり、「費用未確定」は出ない。

ローカルカウンターはモック生成POST=1、結果回復GET=0。生成の再送0、実AI実行0。切断を模した終了通信ではChrome側の再試行を含め4件の切断を観測したが、いずれも非課金の終了処理で、生成ジョブの再送とは区別する。試験harnessとcontrols/countsは`/private/tmp/yamadaya-session-browser-*20261020.*`、画面は`yamadaya-local-end-denied-cleared-20261020.png`、`yamadaya-local-end-disconnect-cleared-20261020.png`、`yamadaya-local-session-fixed-home-20261020.png`へ非公開保存。

試験用の4183サーバーは終了後に停止した。実ブラウザで確認した範囲は、通常のsessionStorageが利用できる場合の403・通信切断・再読み込み・手動復帰。ストレージ保存例外の負例は自動試験で扱い、実ブラウザで容量超過や保存拒否を再現したとはしない。終了未確認フラグはタブ単位で、保存できない場合はそのタブ内の消去とロックを維持するが、再読み込み後や別タブへの持続は保証しない。既存ダウンロードの消去や、端末停止による表示済み画面の即時消去も保証の対象外。

**修正はローカルで検証済みだが、Vercelのモック配備は更新していない。** クラウド上の旧画面の入力消去の問題は、修正版の配備・実ブラウザ再試験前に解消済みとは扱わない。MacのChrome/OS再起動後の安定性とWindows/2台の受入も残件。今回の追加OpenAI実行0、追加入金0、新規有料契約なし、元の期限・実台帳・未確定3件$0.45は維持。以下は先行する接続確認の履歴。

## 通常Chromeの再確認と次の手順（2026-10-20）

本人の「次どうする」に対し、Windowsへ進む前にMacの拒否原因を調べる段階へ戻った。既存のWAF式・対象host・Active/Blockを実画面で照合し、次の一時診断ルール1件を前置した。

```text
(http.host eq "ai-mock.superyamadaya.com"
 and not cf.tls_client_auth.cert_verified
 and not cf.tls_client_auth.cert_presented)
```

名前は`Yamadaya mock diag - certificate not presented`、IDは`aed3713ff5dc4582aff527fb3d2720ee`。Blockだけを追加し、式は元の拒否条件の部分集合である。元の未検証/失効/指紋不一致のBlock、Worker検証、Vercel HMAC/端末認証を残し、Allow/Skipや認証なしの診断経路は作らなかった。[cert_presentedの公式定義](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.tls_client_auth.cert_presented/)は有効・無効を問わず証明書提示時true、mTLSなしはfalse。

診断追加後の新規通常Chromeタブはホームへ到達し、基本4画面・再読み込み・利用終了とホーム復帰・その後の再読み込みを確認した。ログイン/証明書選択のダイアログは出ていない。今回は拒否イベントを再現できず、診断ルールが修正になった、HTTP/3が原因だった、一定時間の伝播で必ず解決する、のいずれも断定しない。

最後に**診断ルールをDisabledへ戻し、元の端末制限ルールのActiveを確認**した。その状態で新しい通常Chromeタブのホームと再読み込み完了を実確認。Chrome拡張操作の接続も応答するようになったため、後半は検証タブをIDで固定し、別ウインドウのフォーカスへ依存せず確認した。最初の最終画面取得は別のPolicyウインドウだったため証拠に採用せず、固定した検証タブのロード完了後に画面を保存し直した。

| 再確認 | 結果と範囲 |
|---|---|
| 通常Chrome | HTTPSのホーム、4機能画面、再読み込み、利用終了→新セッション→再読み込みを確認。画面送信0で、AI品質/モック生成の試験ではない |
| 最終入口 | 診断Disabled/元ルールActiveで、通常Chromeの新規タブと再読み込み成功。診断用の無効ルール1件は監査用に残る（Freeの枠は2/5、Activeは元の1件） |
| 最小権限DB | 専用project/公式CA/厳格TLSでjobs=0、imported=false、paused=true、Mac active・実指紋/元期限一致を再確認。devices/sessionsの直接SELECTは42501のまま。総件数は未確認 |
| 拒否 | 診断有効時も証明書なし・偽装ヘッダーの両方403。診断Disabled後の最終実HTTPでも、証明書なしのCloudflare入口とVercel直接URLは両方403 |
| 試験環境 | 最終Node HTTP試験のsandbox実行はDNS解決ENOTFOUNDで停止し、ネットワークを許可した同じGETで成功。環境の停止とアプリ応答を区別する |
| 変更しなかった設定 | QUIC/HTTP3、拡張、Chrome全終了、CA全面信頼、元の指紋・期限・拒否条件、既存14 DNSレコードは今回変更なし。証明書/鍵の再作成もなし |
| 次の実機作業 | Windowsで`Win+R → tpm.msc`の状態確認だけを依頼。CSR/鍵作成・証明書発行/install・Windows接続はまだ実施していない |

証拠は非公開の`/private/tmp/yamadaya-mac-normal-https-home-20261020.png`、`yamadaya-mtls-final-rules-20261020.png`、`yamadaya-mac-normal-final-home-20261020.png`。読み取り検査のreceiptはGit対象外の`.runtime/hosted-mock/device-http-verification-20261020-later.json`と`device-http-final-20261020.json`。後者は診断を戻した後の拒否試験で、前のreceiptは上書きしていない。

今回の追加AI実行0、ジョブ0、新規有料契約・追加入金なし。元の2026-10-26 08:47:54 JST・実台帳/未確定3件$0.45を維持する。**Macで一連の操作が通った範囲と、Chrome/OS再起動後の再現性・個別停止・Windows/2台受入の未確認を区別する。** 以下は接続初期と403再現時の履歴。

## MacのmTLS実接続（2026-10-20最新）

先行するChrome拡張の操作接続は無応答だったが、本人の「Chromeは開けている」との連絡後、ネイティブChrome操作へ切り替えて再開した。別プロファイルのMembers画面に一時的にフォーカスが移った際は操作を止め、Windowメニューで検証用プロファイルへ戻した。メンバー・招待・アカウント権限は変更していない。

| 対象 | 実施・実測結果 |
|---|---|
| Mac証明書 | 既存の非エクスポート鍵の公開CSRをCloudflareへ送り、公開葉証明書1件を発行。最短1年の2027-10-20まで有効。対象hostは`ai-mock.superyamadaya.com`だけ。CN/CA=false/clientAuth/期限/公開鍵一致を検査してlogin Keychainへinstall、既存秘密鍵とのIdentity対応を確認。秘密鍵/PFXの出力なし |
| 用途検査 | Cloudflare証明書はKU拡張を省略していた。KUがある場合のdigitalSignature必須・keyCertSign/cRLSign拒否、必須EKU/CA=false/公開鍵照合は維持し、RFC 5280に従ってKU省略を許容。修正helperの非永続自己試験13項目合格 |
| 専用入口 | `ai-mock.superyamadaya.com`をWorker Custom Domainとして接続。先に同hostの全拒否WAFを置き、後から実Mac指紋だけを許可。現行Block条件は未検証証明書・失効証明書・不一致SHA-256指紋のOR。既存14 DNSレコード・www/シフト/外販を変更していない |
| Worker | 既存Wrangler認証を使い、レビュー済み10,698byteのWorkerを公開targetなしでuploadしてから、保護済みの専用hostだけを接続。`workers.dev`とPreview URLsは双方Disabledを実画面で確認。接続秘密はCLI stdinからSecretへ保存し、値を表示/ソース埋込みしていない |
| 専用DB | 最初の登録SQLは変数名の曖昧性42702でINSERT前に停止。`v_device_approved_until`へ修正し、ローカルPostgreSQL試験2件後、専用projectのSQL Editorで成功。結果はdevices=1、jobs=0、imported=false、paused=true、元の期限一致=true。実台帳・未確定3件$0.45を読取/import/変更していない |
| Chrome証明書選択 | exact host・実発行者CN・Mac端末CNに限定した1件だけを追加。`chrome://policy`再読込でPlatform/現在のユーザー/推奨/OKと実値を確認。既存設定は未設定だった。全ホスト/全証明書許可やCA全面信頼を追加していない |
| 新規シークレット接続 | 証明書選択/従業員ログインの画面なしでホームを表示し、AIチャット・POP・画像・文章の4画面へ遷移。AI送信ボタンは停止、送信0。認証済みの同ブラウザで`/api/admin`は`FORBIDDEN`・`notDispatched:true`。画面/JS/CSS/セッションまで到達したが、モック生成自体は有効化していない |
| 未登録/偽装の拒否 | 現行WAFへの既定TLSの実HTTP試験で、証明書なしGETとTLS/Access/HMAC/端末ヘッダーの偽装GETが双方403。Macの証明書を別クライアントへ書き出して試していない。結果は非公開`.runtime/hosted-mock/device-http-verification-20261020.json`へ保存 |
| 最小権限DBの再照合 | 実ブラウザ接続後のread-only runtime呼出しでもjobs=0/imported=false/paused=true。Macがactive、登録指紋一致、`not_after`元期限一致。devices/sessionsの直接SELECTは双方42501で拒否され、その資格情報での総件数は未確認。SQL Editorで登録直後に確認したdevices=1と区別する |
| 通常Chrome | 当初の証明書選択後とポリシー反映後の新しいタブで403。Security Eventsの該当Rayは意図した専用WAFルールでBlock、HTTP/3だった。Close idle sockets後も403。新規シークレット接続は成功しており、証明書や指紋が常に不適合という結果ではない。通常Chrome完全終了/再起動後の試験へ続けた |

### Chrome再起動後の追試・画面復旧

本人の終了・再起動操作後、通常Chromeだけでなく新規シークレット接続でも403を再現した。再起動後も`chrome://policy`のexact host/issuer/CN・現在のユーザー/推奨/OKは維持されている。したがって初回シークレット成功は一度の実測として保持するが、安定利用・再起動後合格にはしない。単なる起動中の古い接続だけが原因とは判断できず、HTTP/3・接続再利用・証明書送信条件などの切り分けが残る。QUIC無効化、全zoneのHTTP/3変更、WAF緩和、拡張の無効化は行っていない。

終了で閉じた14タブのウインドウはChromeの「履歴 → 14個のタブ → ウィンドウを復元」で復旧し、元のローカル操作見本`127.0.0.1:4177/`のホームを前面へ戻した。保存済みタブグループも存在を確認した。各タブの未保存入力やシークレット履歴まで完全復元したとの保証ではない。通常接続の問題を解決する前に、Windowsの鍵生成・登録へは進めていない。

元の接続期限は**2026-10-26 08:47:54 JST**のまま。証明書の1年有効性とアプリへの接続許可は別で、DB端末の`not_after`で元の期限を強制する。試用終了時のCloudflare証明書失効は別の終了手順として残る。MacはソフトウェアKeychainの非エクスポート設定であり、Secure Enclaveや物理端末アテステーションの合格ではない。

通常Chromeの失敗原因は未確定。[Cloudflare公式の接続再利用/TLS session resumptionの注意](https://developers.cloudflare.com/learning-paths/mtls/mtls-app-security/related-features/#tls-session-resumption)と整合する候補だが、HTTP/3自体を原因と断定しない。FreeのSecurity Eventsは標本ログで、当該イベントにTLS各値の表示はなかった。Traceは実RayのTLS状態再現ではない。保護条件は緩めていない。Chrome再起動後は上記の失敗、OS再起動・Windows・2台間の独立性・個別失効・実CPU/無料枠超過時の動作は未検証。

既存認証で行った操作は追加AI実行0、新規有料契約/add-on/追加入金なし。既契約のVercel Pro/Supabase MicroとWorkers Free内での配備・HTTPの確認であり、インフラ従量使用や請求確定が0ドルであるとの保証とは区別する。

自動承認レビューは、公開workers.devを作る初期Hello World Deployと、全trafficへログインを要求するAccess設定をそれぞれ拒否した。どちらも適用せず、公開targetなしのupload→保護済み専用Custom Domainという別の構成で接続を完了した。未解決の承認待ちはない。

接続後の公開検査は77ファイル・秘密検出0、`git diff --check`は成功。自動244件は先行するアプリ/Worker試験、helper13項目はKU修正後、SQL2件は登録SQL修正後の別試験であり、今回新しく244件を再実行したという集計にはしない。

画面証拠は非公開`/private/tmp/`の`yamadaya-mac-client-certificate-20261020.png`、`yamadaya-mac-device-db-20261020.png`、`yamadaya-chrome-cert-policy-20261020.png`、`yamadaya-mac-https-home-20261020.png`、`yamadaya-mac-admin-denied-20261020.png`。証明書/CSR/秘密値/実指紋は公開ソースへ追加しない。

以下は同日の接続前の記録で、未発行・未upload・Chrome停止の記載は上記の進捗で更新された。

## Macの鍵作成とモック配備（2026-10-20）

ユーザーは、指定2台分の証明書発行・非公開保存と専用モックの接続設定を明示承認した。追加の確認は不要で、元の接続期限2026-10-26 08:47:54 JST・従業員ログイン不要・追加AI実行/追加契約なしを維持する。以下は承認後に実施した内容。

| 対象 | 実施結果 |
|---|---|
| Mac端末鍵 | 今回専用タグだけを検索し、未作成を確認。初回は`-67731 / The key usage is incorrect`で失敗し、再照合でも鍵なし。Apple標準のRSA用途指定に戻した構成で、login KeychainへのRSA2048永続生成とCSR署名に成功。再取得で`kSecAttrIsExtractable=false`を確認した。秘密鍵の書出しはしていない |
| 公開CSR | Security APIで署名し、OpenSSL `req -verify`がverify OK、CN一致。Git対象外`.runtime/hosted-mock/device-cert/mac.csr`へ0600で保存、親directory 0700。証明書自体はまだ未発行・未install。ソフトウェアKeychainの属性確認でありSecure Enclave/物理端末アテステーションの実証ではない |
| 接続用秘密 | 異なる32byte乱数からgateway/session秘密を生成し、ローカル0700/0600と専用VercelのProduction専用Secretへ保存。公開/固定originの設定も含め今回4件追加、既存6件と合わせて10件。値はCLI stdinで渡し、表示・ソース埋込・Preview/Development保存をしていない。Cloudflareへの保存は未実施 |
| モック配備 | 対象team/project IDを再照合後、検査済みBuild Output API bundleを公式CLI 64.5.0で配備しREADYを確認。deployment ID `dpl_4ULt3qTHqEWegkaNm54Gri6m7ops`、Production alias `yamadaya-ai-trial.vercel.app`、固有URL `yamadaya-ai-trial-3zkmb1oiw-yuki-yamadaya.vercel.app`。実AI provider/公開staticを含めない。モック生成もimport未完了・pausedのまま |
| 直接URLの実HTTP試験 | Productionのホーム、JS、CSS、session、admin、偽装端末ヘッダー、署名なしPOSTの7条件がすべてHTTP 403 `GATEWAY_REQUIRED`。固有URLは302で`https://vercel.com/sso-api`へ転送され、アプリ本文を返していない。任意の302を拒否成功と判定せず、固有URLの当該origin/pathだけを確認した。認証回避tokenは使用していない |
| Macからの段階登録 | gatewayの許可リストを「登録1〜2台、最大2台」に限定。未登録Windowsの架空指紋は作らずMacだけで開始できる。0台/3台/重複ID/重複指紋/未知証明書を拒否する試験を追加。端末認証を省略した試験用経路は追加していない |

最終自動は**244/244合格、失敗0、skip 0**（約8.87秒、非公開ログ`/private/tmp/yamadaya-mtls-tests-20261020.log`）。修正後Mac helperの非永続鍵による自己試験9項目も合格。再生成Workerは10,698bytes、SHA-256 `ead860226602cea6d68d90a1597f4dbf353346cf4aebaa48f9dd043f2627beff`、未upload。公開検査77ファイル・秘密検出0。実HTTPの結果は非公開`.runtime/hosted-mock/origin-denial-20261020.json`へ保存した。244件のローカル試験、Vercel実HTTP、未実施の実ブラウザを区別する。

**現在の停止理由はChrome操作接続の無応答。** セッション名の設定/一覧取得がtimeoutし、再接続の状態確認もtimeoutしたため、同じ操作を繰り返さず本人へChrome接続確認を依頼した。CloudflareへCSRを送信しておらず、証明書0・専用DNS/WAF/Worker/DBの端末登録は今回未変更。Cloudflare/配備画面の今回のスクリーンショットは取得できず、配備の根拠はCLI READYと実HTTPで、ブラウザ合格とはしない。

再開後はMac CSRを署名→公開証明書を照合/install→専用ホストのmTLS/WAF/WorkerとMacの実指紋・期限を登録→Chrome初回許可/自動選択→接続/拒否/個別停止を確認する。Windowsの鍵は当該Windows内で生成する必要がある。普段の共用Windowsユーザーで公開INF/`certreq -user`を実行し、公開CSRだけを本人が会社メール等の既存手段でMacへ渡す。私用Googleログイン・USB・PFX移送・実行ポリシー無効化は不要。TPM確認だけ別管理者で行った場合も、CSR生成/acceptは普段のユーザーに戻す。Mac開通前にWindowsの登録完了とは扱わない。

今回のOpenAI実行0、追加入金0、新規有料契約/add-onなし。既契約Vercel Pro/Supabase内の配備・HTTP使用であり、実請求の照合やインフラ従量利用が常に0ドルであることの保証とは区別する。実台帳・未確定3件$0.45・既存業務DB・既存サイトの設定は変更していない。

## 2台認証の接続前準備（今回）

2026-10-19、ユーザーがこのMacと会社のWindows 11/Chrome 1台でのモック接続試験を指示した。従業員ログイン不要、追加AI実行・追加契約なしを維持する。今回はホーム/静的資産/セッションの認証と拒否を先に確認し、DBの`imported=false`・`paused=true`を維持して生成を有効にしない。実台帳・未確定3件$0.45は読取/import/変更しない。

| 対象 | 今回の確認・実装 |
|---|---|
| Cloudflare実画面 | 有効なFreeゾーン、Cloudflare発行client certificate 0、mTLS対象ホストなし。CSR入力方式を確認したが未発行・未保存 |
| 名前解決 | 公開NSはdoug/reza.ns.cloudflare.com。候補`ai-mock.superyamadaya.com`はNXDOMAIN。旧WARP/Tunnel名`ai-trial.superyamadaya.com`のローカルhostsと混同しない専用名を選ぶ。既存サイト/シフト/外販の設定変更なし |
| 証明書の期間 | フォームの最短は1年（1/2/3/10/15年）。アプリへの接続許可と区別し、deviceのnot_after・期限付きDB loginを元の2026-10-26 08:47:54 JSTより延ばさない。終了時の証明書失効は別作業として残る |
| 端末CSR helper | `tools/device-cert/`にMac SwiftとWindows PowerShell、手順書を追加。各端末内で秘密鍵を生成し公開CSRだけをCloudflareへ送る準備。Macはlogin Keychain非エクスポート設定、WindowsはTPM必須・非エクスポート・ソフトウェアへのfallbackなし。永続生成/登録はまだ実行していない |
| Worker bundle | `scripts/build-cloudflare-worker.mjs`を追加。既存lockのRolldownでレビュー済み3ソースだけを単一ESM化し、default exportを維持、外部依存/Node APIを拒否。秘密/envは読込・埋込しない。生成物はGit対象外、10,671bytes、SHA-256 `5e454a59848cf47dc5bf7f1522749ef466c60f4d403ddd80f1a2bd129d2aa125`、0600。未upload |
| GCの上限 | 画像objectの物理削除成功後、DB metadata削除を上限32件ずつに分割。schedulerやクラウド側の生成を有効にしていない |

Cloudflare **zone-level mTLS**はFreeで100証明書まで。一方、Access mTLSは別の有料条件なので今回使わない。Workers Freeはアカウント全体10万request/日・CPU 10ms/requestで、実CPU/無料枠/fail closedはクラウド受入時の確認が残る。[証明書の条件](https://developers.cloudflare.com/ssl/client-certificates/create-a-client-certificate/)、[Access mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)、[Workers制限](https://developers.cloudflare.com/workers/platform/limits/)。

最終自動試験`RUN_LOCAL_TLS_SOCKET_TESTS=1 npm test`は**243/243合格・失敗0・skip 0**（約8.18秒）。Worker追加6件でTLSなし/live modeの転送0、偽装ヘッダー除去、origin verifierとのHMAC互換、依存の閉域を確認した。GC追加4件で33件/133件・Storage失敗・metadata途中失敗と再開を確認した。外部AI/クラウドは呼び出していない。ログは非公開`/private/tmp/yamadaya-auth-preparation-tests-20261019.log`。Vite/hosted build成功、bundle244ファイル・公開static 0・実AI provider 0、entry import成功。公開検査77ファイル・秘密検出0。

Mac helperはSwift 6.4でコンパイルし、非永続メモリ鍵による自己試験9項目に合格。Security API/OpenSSLのCSR署名検証、破損署名、異なるCN、CA=true、clientAuth欠落を検査した。sandboxではlegacy最小引数のRSA生成も`-50`で失敗したため、自己試験はmodern Keychain APIの非永続経路で実施。**login Keychainの永続・非エクスポート鍵生成の合格とはしない。** 永続Keychain変更0、秘密鍵書き出し0、ネットワーク呼出し0。Windows TPM/CSR/Chromeは未実行。

新しい鍵/証明書・署名秘密の発行と専用入口設定について、ブラウザ操作規則による実行直前の確認を一括で提示した段階。**実証明書、Cloudflare/WAF/Worker/DNSの保存、Vercel配備、Mac/Windowsの接続・拒否・個別停止は未実施で、2台限定を実機合格とはしない。**

## 専用クラウド環境の準備状況

2026-10-19、本人の作成完了後、新しいSupabase project `yamadaya-ai-trial`（ref `pgcvetybmtvojpivfjdm`）のMicro/Tokyo・Healthyを確認。Connect画面の警告でData API無効を確認した。読み取りだけのSQL事前検査ではPostgreSQL 17.11、editor role `postgres`、role作成可能、アプリ用schema/role未作成だった。共有transaction poolerは`aws-0-ap-northeast-1.pooler.supabase.com:6543`、DBは`postgres`。パスワード・キー・接続URLの秘密値は本文へ記録しない。

Vercelの対象team `yuki-yamadaya`（`team_bOOTNM1NDS7gqeOaYtU5UvvI`）に同名の空projectを作成した。project IDは`prj_2cNSI2ySb9QG4ddy1B53mZlX0gTb`。管理コネクターの403で作成できなかったため、公式CLI 64.5.0を使用し、ブラウザでProduction/Previewともdeployなしを確認した。`shared-web/.vercel/project.json`へlinkし、CLIがproject-scoped OIDCをGit対象外の`.env.local`へ自動更新した。値は表示・文書化していない。画面証拠は非公開の`/private/tmp/yamadaya-vercel-empty-project-20261019.png`。

ユーザーは、この専用環境だけへのモックDB・最小権限アプリ用DB資格情報・private画像保存領域の作成、およびDB接続情報/StorageキーのこのMacへの非公開保存と同名Vercel projectのサーバー専用設定への保存を明示承認した。以下はその許可内で完了した準備。既存業務DB、実AI、一般公開、追加契約は対象外で、操作していない。

`scripts/prepare-hosted-db.mjs`を追加し、専用projectを固定した非秘密のSQL案だけを生成できるようにした。初期案`/private/tmp/yamadaya-hosted-bootstrap.sql`（SHA-256 `301739d8919c1ae84c5fdd8d137b80edaaf6a86ec6b52183d8975b048b4112ef`）は、既存public RLS helperを検出して`P0001`でrole作成前に停止。履歴として保持し、以後の実行候補にしない。厳密照合を追加したレビュー版`/private/tmp/yamadaya-hosted-bootstrap-reviewed.sql`（SHA-256 `6b6a53d7e9b3e5d121ca1cd8f4de41688fc78eff4845ddd240115c15a9083759`）を、表示名/refが一致する新projectのSQL Editorで実行し、PostgreSQL 17.11で成功した。実台帳の読取/import/変更はしていない。

レビュー版は`public.rls_auto_enable()`の取得済み定義hash・所有者・言語・戻り型・SECURITY DEFINER・固定search_pathと、`ensure_rls`の有効状態・所有者・正確なイベント/タグを実行前後に照合した。vendor helper/trigger自体は変更せず、別のpublic業務オブジェクトや既存アプリschema/roleがあれば停止する。レビュー用4試験はPGlite/PostgreSQL 18.6、実DDLは17.11での別の確認として記録する。

| 準備対象 | 実施・確認結果 |
|---|---|
| DBの分離とrole | `yamadaya_mock`だけを作成。owner/runtimeはNOLOGIN、webだけLOGIN。webのmembershipはruntimeをINHERIT TRUE・SET FALSEで1件だけ、接続上限4。サーバー側でSCRAM用の初期資格情報を生成し、平文をSQLソースへ入れない。期限は2026-10-25 23:47:54 UTC＝10月26日08:47:54 JST |
| DB実接続・拒否 | web roleでTLS接続、hostname検証、READ COMMITTEDとruntime usage取得が成功。imported=false、paused=true、jobs=0、devices=0。直接table、import、SET ROLE owner/runtimeは全て42501で拒否 |
| TLS | CA未指定の初回接続はSELF_SIGNED_CERT_IN_CHAINで失敗。rejectUnauthorized=trueを維持し、新projectのDatabase Settingsから公式CAを取得して`HOSTED_DATABASE_CA`対応を追加。SHA-256指紋`807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`を記録。SSL enforcementを新DBだけで有効化・再起動し、TLSなしのダミー認証はXX000 SSLRequiredで拒否。実パスワードを平文接続で送らない |
| 画像bucket | `yamadaya-mock-images`をprivate/Public OFF、最大10MB、許可MIME png/jpeg/svg+xml、policies 0で保存・再表示確認 |
| Storage用キー | 名前付き`sb_secret_*`キー`yamadaya_hosted_mock_storage`を作成。専用project全体のservice_role/BYPASSRLS権限を持ち、bucket限定の最小権限キーではない。既存業務projectとは分離。画面に自動期限指定がなく、終了時の明示失効が必要 |
| ローカル秘密保存 | `shared-web/.runtime/hosted-mock`の非公開credentials JSONへ保存。directory 0700・file 0600。値をチャット・ソース・報告・VITE変数へ載せない |
| Vercel設定 | 新projectのProductionだけにMODE/PROJECT_REF/STORAGE_BUCKET/STORAGE_SERVER_KEY/DATABASE_URL/DATABASE_CAの6個の`HOSTED_`変数をSecretとしてCLI stdin経由で登録し、通常CLIのmetadataとブラウザで確認。Preview/Developmentには登録なし。gateway/session/origin設定はまだなく、アプリdeployも0で既定拒否を維持 |

実Storageで1pxのダミーPNGをput→get→hash一致→inventory list→deleteまで確認し、検証objectを削除した。公開URLはHTTP 400で取得不可。Storageの新しいopaqueキーは`apikey`だけを送り、従来JWTキー向けBearer方式と区別するよう修正・試験した。画面証拠は非公開の`/private/tmp/yamadaya-private-bucket-settings-20261019.png`、`/private/tmp/yamadaya-hosted-db-permissions-20261019.png`、秘密値や請求先住所を含まない`/private/tmp/yamadaya-vercel-server-secrets-20261019.png`。

`env ls --json`は値を読み取る可能性があるとして自動承認レビューで拒否されたため実施せず、秘密値を返さない通常のmetadata一覧へ切り替えて登録確認を完了した。この件による未完了の操作はない。

## 実装・選定理由

| 対象 | 実装と理由 |
|---|---|
| 画面 | React/Vite継続。基本4機能・POP提案確認・PDF保存を維持し全面移植を増やさない |
| HTTP | `hosted/app.mjs` / `node-entry.mjs`。全ルート認証、許可リスト配信。Build Output APIでHTML/CSS/JSは関数内、公開static無し |
| 認証候補 | `gateway.mjs` / `origin-auth.mjs`。zone mTLSのtrusted TLS情報＋HMAC。改ざん・nonce再利用・失効・直接originを拒否。実Cloudflareは未試験 |
| 共有台帳 | `ledger.mjs` / `migrations/001-hosted.sql`。Postgres共有ロック・原子的予約・実行者lease。起動時一括unknown化はせず、lease切れは保留して再実行しない |
| 依存 | 固定版pgをサーバー接続、PGliteを開発用の実PostgreSQL/WASM試験に使用。依存の追加そのものでは有料リソースを作成しない。専用projectの作成とは分ける |
| 画像 | 専用projectのprivate Storage。最大10MiBを2MiB単位で取得しSHA-256一致。公開/署名付きStorage直URLやキーをブラウザへ渡さない。実bucket上限10MBとの整合も受入時に確認する |
| 保持/削除 | 本文はDB非保存、画像manifestのみTTL15分。終了/失効で取得拒否、bytes削除成功後にpointer削除。独立Storage inventoryでクラッシュ後の孤立objectも回収 |

秘密値はVITE変数・ログ・ソースへ入れない。新projectだけのStorage資格情報と最小権限DB loginを分け、既存業務projectのpostgres/service_role/keyを流用しない。Storageキー自体の権限はproject全体に及ぶため、private bucketやRLSだけで漏洩時の権限を狭めたとは扱わない。

## 安全条件

- 2台限定・従業員ログイン不要・基本4機能のみ。管理API・業務DB・社内LANへの経路は作らない。
- 実試用の合計$10、未確定3件$0.45、元の期限を維持。同じ未確定内容は再送せず、ID/予約/入力hashの完全一致snapshotから新unknownが増えたら停止する。
- 実台帳importは一度だけ。全metadataの件数・費用・予約・hashを照合し、空DBで新しい$10として再開しない。今回は実台帳の読取/import/変更をしていない。fixtureのID・金額は架空。
- モックは`yamadaya_mock`、実試用は`yamadaya_trial`。runtimeは`HOSTED_MODE=mock`以外を拒否し実AI providerをimportしない。モックで実試用枠を消費しない。
- 会話・文章・提案本文はDBへ保存しない。成功後の切断では本文回収不可を表示し、同じ操作IDで再実行しない。画像だけ短期manifestで回収可能。
- SQLは専用project確認ガード付き。migration ownerとruntime loginを分け、固定関数のみ実行可能。anon/authenticated/service_role/runtimeの直接table access、runtimeからのimport/予算変更を拒否する。

## 検証結果

最終`RUN_LOCAL_TLS_SOCKET_TESTS=1 npm test`: **233/233合格、失敗0、skip 0**（約8.79秒）。従来223件へSQL準備・vendor helper照合・Storageキー互換・CA設定などの検証を追加した。初回の通常sandbox実行はローカルTLS socketの`EPERM`で止まったが、ローカルsocketを許可した再実行で全件合格した。環境による停止とアプリ失敗を区別する。自動試験では外部AI・クラウドを使っていない。実DB/Storageの確認は上記の別試験。最終CLIログは非公開の`/private/tmp/yamadaya-hosted-final-tests-20261019.log`。

`npm run build:hosted`、`node scripts/check-hosted-bundle.mjs`成功。bundle244ファイル・公開static0・実AI provider0・ローカルharness0、entry import成功。最終`npm run check:public`は公開ソース許可リスト71ファイル・秘密検出0、差分の空白検査も合格。Vercelの実ビルド/配備成功を意味しない。

| 層 | 無課金で確認した内容 |
|---|---|
| 暗号/入口 | 未登録・失効・自己申告TLS、method/path/body/Cookie/Origin改変、期限切れ、共有nonce再利用、認証store停止、全HTML/assets/APIの直接origin拒否 |
| SQL | 重複・所有者/実行者不一致、共有予算・期限、新unknown停止、lease、既存unknown保留、import未完了拒否、本文保存拒否、公開role/runtimeの権限拒否、将来admin関数のPUBLIC実行拒否 |
| 画像 | 4MiB超を3chunkで完全一致、別端末/終了済みsession拒否、読取中の終了競合、削除失敗pointer保持、台帳失敗後の孤立object回収 |
| 分離 | モックschemaだけ変化し、同じダミーDB内のtrial集計が不変 |
| ビルド | ローカルのVite/関数bundle。公開static無し、実AI provider/SQLite/実台帳/写真/秘密ファイルを同梱しない |

Chromeの127.0.0.1:4182で「検証用りんご / 1袋298円（税込） / 10月25日限定」・A4横を入力し、提案確認→モック画像表示→PDF保存を実操作。保存PDFは1ページ、296.9999987×209.9999998mm、画像1件。Poppler描画で日本語・中点・画像全体を目視確認。画像型PDFであり文字選択/コピー・旧要素型1mm基準の再合格ではない。4用紙すべての新規実ブラウザ保存は今回未実施。

同じChromeで、ダミーのチャット送信/応答、文章作成/実TXT保存、単独画像作成、修正元JPEGへの引継ぎ/修正送信/結果表示を確認。最後に利用終了→ホーム→画像入力と参照/結果の消去を確認した。見本画像は固定のため、指示どおりのデザイン変更・AI品質を試験したとは扱わない。PDF/TXTは今回のダウンロードだけを読み取り確認。画面証拠は非公開の`/private/tmp/yamadaya-hosted-browser-20261019.png`。

ブラウザ試験の端末情報はローカルharnessが模擬し、画面は「操作見本」。**実証明書・WARP・Cloudflare・会社Windowsの認証試験ではない。** PGliteも単一engineで、独立Postgres接続のMVCC/ネットワーク障害は別受入条件。

## 再現

```sh
npm ci
RUN_LOCAL_TLS_SOCKET_TESTS=1 npm test
npm run build:hosted
npm run mock:hosted
```

harnessは127.0.0.1:4182だけにbind。使い捨てPGlite・ダミー端末・架空台帳・メモリ内Storageを使い、実秘密ファイル/SQLiteを開かない。bundleにはharness/PGlite/migration/実AI providerを入れない。buildはローカル生成のみでdeployしない。

## 費用・許可状態

| サービス | 確認した既存状態 | 想定追加 |
|---|---|---|
| Vercel | 2026-10-19、本人の支払入力後に対象team `yuki-yamadaya` のPro Plan・次回請求予定$20.00を実画面で確認 | Pro $20/月・管理/配備1席・対象インフラ$20credit。既存project利用も合算。超過/追加席/add-onは別。支払済み額・税額の照合は別途 |
| Supabase | 既存Production組織Pro。10/12支払済み$27.50、次回予測$49.18。本人が専用`yamadaya-ai-trial`を作成しMicro/Tokyo・Healthyを確認 | 作成済み専用Micro projectのcompute約$10/月。Pro基本料$25を二重加算しない。ComputeはSpend Cap対象外 |
| Cloudflare | 既存Free。DNS/会社管理引継ぎは先行作業 | zone mTLS無料候補＋Workerの実条件を確認。Access mTLSを無料と扱わず、不成立なら再見積り |
| OpenAI | 元の$10枠/unknown $0.45/許可期限を維持。キー期限更新未完了 | 今回実API $0。月額AI予算は別途未設定 |

比較用1USD=160円・税/カード換算料別で追加約4,800円/月＋AI/超過が目安。$49.18は専用project追加前の予測で「毎月支払済みの固定額」ではない。Wix更新等は既存金額未確認で別枠。本人がVercelをProへ変更し、専用Supabase projectを作成した。今回のDB/Storage/秘密設定はその新project内の準備で、追加契約はしていない。Vercelは空projectのまま、外部deploy・実証明書・公開用DNSレコードは作成していない。

契約前UIのVercelカード未登録・読み込み待ちは過去の状態。後続の本人操作で支払入力と学習利用オプションを選ばない案内確認が完了し、対象teamのProを確認した。Billingの表示はIncluded Credit $0.00 / $20.00、Upcoming Invoice $20.00。Spend Management画面には$200の予算表示もあるが、合意した$10のOpenAI試用枠とは別であり、費用上限や既存project一括停止を変更していない。別途表示されたBilling Address RequiredはAdd Laterで閉じ、請求先住所の入力・保存はしていない。

Supabaseのフォーム準備・本人へのパスワード入力/作成確定の引継ぎは過去の段階。本人の作成完了後、上記refを固定して新projectだけのモック設定を完了した。Data API無効は作成後にも実画面で確認し、レビュー済みDDL・固定関数/RLS・実web roleの権限拒否を確認した。既存業務projectへのSQL/key設定は行っていない。パスワード・キーをチャットへ送る必要はない。

## 実環境で残る受入条件

1. 対象teamのPro変更は確認済み。既存projectを含む実請求・税額は別途照合する。一括自動停止は既存サイト/シフトも止めるため無断で有効にしない。
2. 新専用Supabase Micro、モックschema/role、private bucket、期限付きサーバーlogin、Production専用Secret設定は準備・単体の実接続確認済み。入口用gateway/session/origin設定とアプリの配備・全体結合は未実施。Storageキーの終了時失効も運用に組み込む。既存業務DBへSQL/key設定を行わない。
3. 画像GCを少なくとも5分ごとに実行する非公開scheduler/失敗通知を用意。実Storage APIでTTL/終了/失効/孤立画像の物理削除を確認。schedulerは未配備、localだけ30秒ごとに模擬GC。1回100件を超える滞留も監視する。
4. 検証サブドメイン全体のmTLS/WAF/Worker、2台の証明書・鍵保護/非エクスポート・自動選択・更新/個別失効/交換を試験。証明書2枚だけで物理2台限定を保証しない。
5. AI停止モックで登録2台成功、未登録/同じ会社LANの別PC/証明書なし・失効/直接vercel.app・preview/偽装ヘッダー/Storage直取得の拒否を実機確認。ブラウザのSupabase REST/RPC/GraphQL/Storage/Realtime拒否も試す。
6. 独立Postgres接続・複数Vercelインスタンスで競合/切断/timeout/再起動/lease/GC障害を試す。PGlite成功で代用しない。
7. 実AIへ移す前に実台帳を全件照合して専用trial schemaへ移行し、期限/残枠/unknownを保持。キー更新の対象/権限/期限を示す。今回は追加AI実行・追加入金なし。

## 公式資料

2026-10-19確認: [Vercel Pro](https://vercel.com/docs/plans/pro-plan)、[Build Output API](https://vercel.com/docs/build-output-api/primitives)、[Functions制限](https://vercel.com/docs/functions/limitations)、[費用制御](https://vercel.com/docs/spend-management)、[Supabase Compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute)、[private Storage](https://supabase.com/docs/guides/storage/serving/downloads)、[zone mTLS](https://developers.cloudflare.com/api-shield/security/mtls/)、[Access mTLS条件](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)、[Worker TLS情報](https://developers.cloudflare.com/workers/runtime-apis/request/)。

今回のDB/Storage接続で参照: [Supabase SSL](https://supabase.com/docs/guides/platform/ssl-enforcement)、[node-postgres SSL](https://node-postgres.com/features/ssl)、[APIキー移行とopaqueキーの送信方法](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)、[標準RLS event trigger](https://supabase.com/docs/guides/database/postgres/event-triggers)。

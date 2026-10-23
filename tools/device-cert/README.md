# 端末証明書のローカル準備と適用記録

2026-10-20 最新（Windows）：本人がTPM準備済み→公開CSR作成→公開証明書転送→CurrentUser Myへの追加を実施。certreqの信頼チェーン構築エラー後、対象証明書1枚・TPM Providerに絞った関連付け修復を案内し、本人が秘密キー対応表示を確認した。Chromeの既存ポリシー確認・自動選択・実接続は残る。ルート信頼の追加や鍵再生成は行っていない。[最新結果](../../docs/live-trial-preparation-20261020.md)を優先し、以下の未実施記述は先行段階の履歴として扱う。


2026-10-20の最新：ユーザーが指定2台分の発行・非公開保存と専用モック設定を明示承認。Macのlogin Keychain非エクスポートRSA2048鍵1件と公開CSRを作成し、属性の再取得・OpenSSL CSR署名検証が成功した。Cloudflareで最短選択肢の1年有効のMac証明書を発行し、既存鍵との公開鍵一致・Identity対応を確認して公開葉証明書をインストール済み。既存Mac鍵を再生成しない。

MacのChrome自動選択は、対象ホスト・実際の発行者CN・Macの端末CNに限定した1件を適用し、`chrome://policy` で現在のユーザー・推奨（recommended）・Status OKを確認した。最新の11:20〜11:27 JST頃の通常Chromeでは、ホーム・基本4画面・再読み込み・利用終了後の新規セッションが成功し、新たな証明書選択やログイン要求はなかった。一時的な診断Blockの無効化後もホームの再読み込みは成功した。これ以前に生じた通常／シークレットの403と再起動直後の失敗は履歴として保持し、原因や安定復旧は未確定とする。Windowsは現在操作できないため保留。TPM確認・CSR作成・証明書発行／インストール・接続試験は未実施で、今の返信や作業は不要。[現在の結果](../../docs/hosted-preparation.md#macのmtls実接続2026-10-20最新)と[管理者の運用手順](../../docs/device-operations.md)も参照する。

対象はこのMacと会社のWindows 11 / Chromeの2台、試験ホストは `ai-mock.superyamadaya.com`。2026-10-19の準備時点ではこのホストはNXDOMAINだった。これらのローカルツール自体はDNS・Cloudflare・Vercel・Supabase・Chromeポリシーを変更せず、AI実行・課金・ネットワーク通信もしない。10月20日のホスト設定・証明書発行・Chromeへの適用は、承認済みの別作業として実施した。

**永続鍵の作成・証明書発行・インストールは、対象・用途・期間について実行直前の明示許可を得てから行う。** 2026-10-19の準備時点ではコンパイルと `--selftest` だけだったが、10月20日に指定2台の許可を受領済み。別端末や追加鍵の発行へ拡張しない。試用終了は元の **2026-10-26 08:47:54 JST** のまま。証明書がそれより後まで有効でも、サーバー側の元の期限を延長しない。

秘密鍵は利用端末で生成する。Cloudflareへ送るのは公開CSR、端末へ返すのは公開証明書だけ。秘密鍵ファイルやPFXを作成・転送しない。公開CSR・証明書にも端末識別名があるので、リポジトリに追加しない。

実Cloudflare画面の証明書の最短Validityは1 Yearで、2026-10-20のMac証明書発行でもこの選択肢を使用した。アプリの元の期限は変えず、試用終了時にCloudflareで個別失効する。2026-10-19のCSR・鍵の準備だけでは、この長い証明書期限への同意や発行許可を含めず、10月20日の明示承認後に発行した。

## Mac

```sh
swiftc -module-cache-path /private/tmp/yamadaya-device-swift-module-cache shared-web/tools/device-cert/mac-identity.swift -o /private/tmp/yamadaya-mac-identity
/private/tmp/yamadaya-mac-identity --selftest
```

`--selftest` は非永続の一時RSA鍵からCSRをメモリ内で生成し、Security APIと `/usr/bin/openssl req -verify` の両方で署名を検証する。秘密鍵の書き出しは行わず、既存Keychain項目は検索せず、証明書・鍵・CSRファイルを保存しない。破損CSRと不適切な証明書も拒否する。このsandboxではlegacy既定Keychain経路のRSA生成が最小引数でも `errSecParam (-50)` になったため、自己試験は `kSecUseDataProtectionKeychain=true` の非永続メモリ内鍵で実施する。原因が非エクスポート属性であるとは断定しない。実際の `--prepare` だけがlogin Keychainの永続＋非エクスポートを必須にし、属性が偽でなければ停止する。永続生成は10月19日の自己試験時点では未試験だったが、10月20日に承認を受けて成功した。実作成初回の用途指定による `-67731` は、任意のCanSign/CanDecrypt/CanUnwrap指定を省略した構成で解消した。

**以下は承認後に実施した操作の形式。既存Mac鍵に対して `--prepare` を再実行しない。別端末や追加鍵には別の許可が必要:**

```sh
/private/tmp/yamadaya-mac-identity --prepare /private/tmp/yamadaya-mac-20261019.csr
/private/tmp/yamadaya-mac-identity --status
/private/tmp/yamadaya-mac-identity --install /private/tmp/yamadaya-mac-20261019.pem
```

- `--prepare`: RSA 2048bit鍵をmacOSの既定login Keychainへ保存。`kSecAttrIsExtractable=false` を最上位に指定し、作成後も偽であることを検査。タグ `com.superyamadaya.ai-mock.mac.20261019.v1`、ラベル `Yamadaya AI mock Mac 20261019`、CN `Yamadaya-trial-Mac-20261019`。既存の同じタグや出力ファイルがあれば拒否。CSR保存失敗後は鍵を残し、重複作成しない。
- `--status`: 当該タグだけを検索して有無と非エクスポート属性を表示。Keychain全件・属性辞書・鍵・秘密情報は表示しない。
- `--install`: 公開証明書のCN、期限、CA=false、clientAuth、公開鍵の一致を確認して葉証明書だけを追加。KU（Key Usage）は存在時にdigitalSignatureを必須にし、keyCertSign/cRLSignを拒否する。KU自体の省略は許容するが、EKUのclientAuth・CA=false・同一公開鍵は必須のまま。既存秘密鍵へのIdentity対応も確認する。CA信頼設定・Keychain ACLは変更しない。

初回のChrome利用時にmacOSが秘密鍵の利用許可を求める場合は、管理者がアプリ名 **Google Chrome** と当該鍵のラベルを確認して「常に許可」を選ぶ。全アプリへの許可やCAの「常に信頼」は設定しない。通常利用で再び許可やパスワード入力が必要なら「ブックマークだけで利用」の合格にはしない。

この鍵は**ソフトウェアKeychainの非エクスポート鍵**であり、Secure Enclaveのハードウェア束縛鍵ではない。通常の鍵書き出しを防ぐ目的で、管理者侵害まで含めた物理端末証明やリモートアテステーションを保証しない。Secure EnclaveはP-256のみで、CloudflareのCSR受付とChromeのIdentity探索は別途未検証。`Keychain Access > Certificate Assistant` の通常CSRだけで非エクスポートを保証したとは扱わない。

## Windows

2026-10-20現在は操作できないため保留。再開できるときにAから進め、各段階の完了箇所を残す。今すぐ回答する必要はない。従業員が普段Chromeを開く共用Windowsユーザーで設定し、私用Googleアカウントへのログインは使わない。

### A. TPMの状態を読む

1. `Win + R` → `tpm.msc` → Enter。
2. 使用準備ができているかを読む。TPMの初期化・クリア・BIOS変更はしない。TPMなし／準備未完了ならBへ進まず保留する。[Microsoftの確認方法](https://support.microsoft.com/en-us/windows/security/devicesecurity/enable-tpm-2-0-on-your-pc)

### B. このWindows内で鍵と公開CSRを作る

1. 会社の既存の受渡方法で、公開ソースの [windows-csr.ps1](windows-csr.ps1) を保存する。内容と対象PCを確認し、そのフォルダのPowerShellで次を1回実行する。

   ```powershell
   .\windows-csr.ps1 -Prepare
   ```

2. デスクトップの `Yamadaya-AI-device-request` 内に `.csr` ができたことを確認する。秘密鍵は同じWindowsユーザーのTPM Providerに非エクスポートで残る。出力フォルダが既存／実行失敗の場合は削除してやり直さず、元の要求を管理者が確認する。

スクリプトの実行ポリシーは無効化しない。使えない場合は、管理者が公開INFを保存し、同じ共用ユーザーで `certreq.exe -user -new "INFのパス" "CSRの保存先"` を使う手順へ切り替えられる。`Get-Tpm` の読取だけに別の管理者ユーザーが必要だった場合も、鍵とCSRの作成は共用ユーザーへ戻して行う。TPM未準備をソフトウェア鍵への変更で回避しない。

### C. 公開CSRだけを管理者へ渡す

1. 会社の既存のファイル共有や添付など、本人が選ぶ方法で `.csr` だけを渡す。USBは不要。秘密鍵・PFX・パスワードを渡さず、このツールからメール等を自動送信しない。
2. 管理者がCloudflareで公開CSRに署名し、返された公開証明書のCN `Yamadaya-trial-Windows-20261019`、期限、clientAuth、CA=false、発行元、CSRとの公開鍵一致を確認する。WAF・Worker・専用DBへの登録も管理者が行い、有効端末を最大2台に保つ。元の試用期限は延長しない。

### D. 同じWindowsユーザーへ証明書を入れる

1. 管理者が確認した公開証明書を保存し、Bと同じユーザーで次を実行する。パスは保存場所に合わせる。

   ```powershell
   certreq.exe -user -accept "C:\保存場所\yamadaya-windows-20261019.cer"
   ```

2. `certmgr.msc` の「個人」で対象CNと秘密鍵の対応を確認する。秘密鍵の移し替えやCAの全面信頼は行わない。[Microsoftのcertreq仕様](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/certreq_1)
3. 管理者が[Chromeの自動選択](#chromeの自動選択mac適用済みwindows未適用)を設定する。対象は `https://ai-mock.superyamadaya.com`・実際の発行者CN・Windowsの端末CNの1件だけ。既存ポリシーは上書きしない。

### E. ブックマークから使えるか確かめる

1. 普段の共用ユーザーのChromeで `chrome://policy` の値・エラーを確認し、対象ホストをブックマークして開く。ホーム・4画面・再読み込み・「利用終了」後の新しいセッションを確認する。現在はAI送信停止のモックなので生成は行わない。
2. 他の作業を保存してChrome再起動後、さらにWindows再起動後も、従業員ログイン・証明書選択が必要ないか確認する。
3. 管理者と[個別停止・他方端末への影響](../../docs/device-operations.md#個別停止)を確認して完了とする。いずれもWindows実機では未実施。TPM Providerの使用は、CloudflareがTPMアテステーションを検証したことを意味しない。

## Chromeの自動選択（Mac適用済み・Windows未適用）

2026-10-20のMacでは、以下の条件を実際の発行者CNで適用し、`chrome://policy` の対象1件が現在のユーザー・推奨・Status OKであることを確認した。シークレットウィンドウでの基本4画面の接続と管理機能の `FORBIDDEN` に続き、最新の通常Chromeでも冒頭の接続試験に成功した。Chrome操作用拡張との接続も再起動後に復帰した。ただし、先行したChrome完全終了・再起動直後の試験は403であり、その後の成功を再起動後の安定利用の合格には流用しない。OS再起動後の利用は未確認。

切り分けのため、対象ホスト完全一致・`not cert_verified`・`not cert_presented` の一時Block（`aed3713ff5dc4582aff527fb3d2720ee`）を元のfallbackの前へ追加したが、現在は無効化済み。元のfallbackは有効・式の変更なしで、無効化後にも通常Chromeのホームを明示的に再読み込みして成功した。診断ルールが403を解消したとは判断しない。接続再利用・証明書選択キャッシュを含む根本原因は未確定。HTTP/3・QUIC・拡張設定・証明書認証の緩和や、他のDNS変更は行っていない。

対象ホストと、**発行された実際の**発行者CN・端末CNの両方に絞る。ワイルドカードホスト、全証明書フィルター、会社ドメイン全体への適用は使わない。以下の `<実際の発行者CN>` は発行後の公開証明書から確認する。

```json
{"pattern":"https://ai-mock.superyamadaya.com","filter":{"ISSUER":{"CN":"<実際の発行者CN>"},"SUBJECT":{"CN":"Yamadaya-trial-Mac-20261019"}}}
```

WindowsのSUBJECTだけ `Yamadaya-trial-Windows-20261019` に変更する。

- Windows: `HKCU\Software\Policies\Google\Chrome\AutoSelectCertificateForUrls` の未使用番号の文字列値へ**1件追加**。既存値を読み取り、控えを取り、既存番号を上書き・削除しない。管理下の既存ポリシーなら配布元の管理者と調整し、HKLMの強制設定を迂回しない。
- Mac: `com.google.Chrome` の `AutoSelectCertificateForUrls` 文字列配列へ1件追加。既存のユーザー設定と構成プロファイルを先に確認し、配列全体の置換や既存プロファイルの削除は行わない。管理ポリシーなら管理者による同一配布方式を使う。
- 反映後は `chrome://policy` で値・適用元・エラー有無を確認し、Chrome終了→再起動とOS再起動の両方で選択ダイアログが出ないか実測する。

ブラウザの自動選択は認可ではない。Cloudflare・Worker・Vercel・共有DBで許可した指紋2件・期限・失効・直接URL拒否を強制する。

## 停止・交換

2026-10-20追試：MacのアプリDB statusを一時停止し、既存タブの通信がDEVICE_REVOKEDで拒否されること、元の指紋/日時/期限へ復元後にホームが再表示されることを実確認した。初回の復元直後は読み込み失敗も観測しており、常に無操作で戻る合格ではない。試験はsessionsを残した状態変更で、Cloudflare証明書の不可逆な失効や2台間の独立性は未試験。終了失敗時の入力残存はローカル修正・ブラウザ検証済みで、クラウド未反映。[実測](../../docs/hosted-preparation.md#windows保留中の停止復元試験とローカル修正2026-10-20)。

1. サーバー側の当該端末を停止し、既存セッション・開いたタブも拒否できることを先に確認する。
2. Cloudflareで当該証明書を失効し、非同期失効処理の完了を確認する。もう1台には影響しないことを試す。
3. 必要な監査情報として公開証明書指紋・発行日・失効日だけを管理用記録へ保存する。
4. 当該端末の証明書・対応鍵と、今回追加したChromeポリシー1件だけを管理者が削除。既存の鍵やポリシーは残す。
5. 交換端末は新しい鍵・CSRから登録する。旧鍵のPFX移送・クローンはしない。試用終了後の継続には別の期限判断が必要。

## 根拠と未実施

[Apple鍵生成](https://developer.apple.com/documentation/security/generating-new-cryptographic-keys)、[非エクスポート属性](https://developer.apple.com/documentation/security/ksecattrisextractable)、[Identity照合](https://developer.apple.com/documentation/security/creating-an-identity)、[Microsoft certreq](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/certreq_1)、[TPM Provider](https://learn.microsoft.com/en-us/azure/attestation/tpm-attestation-concepts)、[Cloudflare独自CSR](https://developers.cloudflare.com/ssl/client-certificates/create-a-client-certificate/)、[Chrome自動選択の仕様](https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/ContentSettings/AutoSelectCertificateForUrls.yaml)。

現在の未実施項目は、Macの現状からChromeを完全終了・再起動した後の無操作利用の再確認、OS再起動後の利用、WindowsのTPM状態確認・CSR作成・Cloudflare証明書発行・インストール・Chromeポリシー適用・実機接続、2端末を合わせた接続・停止・交換試験。Mac永続鍵作成・Cloudflare発行・証明書インストール・Chromeポリシー適用・通常／シークレットからのモック接続は実施済みであり、ローカル自己試験とは分けて記録する。過去の完全終了・再起動直後の403も失敗結果として残す。

2026-10-19のローカル結果（準備時点の履歴）: Swift 6.4でコンパイル成功。`--selftest` はSecurity署名検証、OpenSSL署名検証、CSRのCN/RSA2048/KU/EKU/CA=false、破損CSR拒否、正しい葉証明書の構造確認、異なるCN・CA=true・clientAuth欠落の拒否に合格。この自己試験による永続Keychain変更0、秘密鍵書出し0、ネットワーク呼出し0。当時は永続非エクスポート鍵生成も未試験で、WindowsのPowerShell/TPM実機試験は現在も未実施。

2026-10-20: Cloudflare発行証明書のKU省略に対応。[RFC 5280 §4.2.1.3 / §4.2.1.12](https://www.rfc-editor.org/rfc/rfc5280#section-4.2.1.12)に従ってKUがある場合だけ用途制約を検査する。自己試験にKU不在の成功、KUありdigitalSignature欠落・keyCertSign・cRLSignの拒否を追加し、13項目すべてに合格。CSRのKU要求と他の検査は維持する。この自己試験は非永続メモリ内鍵で実行し、既存Mac鍵・OSの証明書ストア・クラウド設定を変更していない。その後、実際のCloudflare公開葉証明書の検査・インストールと既存鍵へのIdentity対応も成功した。

2026-10-20再起動後追試（最新の通常接続成功より前の失敗履歴）: 通常/新規シークレットの双方が403。Chromeポリシーのexact host/issuer/CNと現在のユーザー/推奨/OKは維持された。初回のシークレット成功を安定利用・再起動後合格へ流用しない。閉じた14タブのウインドウを履歴から復元し、ローカル操作見本へ戻した。この時点でWindows実行、QUIC変更、WAF緩和はしていない。その後の11:20〜11:27 JST頃の成功は冒頭の最新結果に分けて記録する。

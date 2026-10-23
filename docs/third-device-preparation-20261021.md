# 3台目のWindows追加準備

日付: 2026-10-21。判断の正本は[ADR-0016](decisions/ADR-0016-third-device-trial.md)。ユーザーがWindows1台の追加を承認。実環境はまだ既存2台の設定で、3台目の接続成功とは扱わない。

## 進め方

1. 新しいWindowsを普段利用するユーザーで開き、`tpm.msc`で状態・製造元・仕様バージョンと、ブラウザを確認する。本人から「互換性のあるTPMが見つかりません」との回答を受領。TPMが無効な場合と非搭載等の切り分けはまだできておらず、鍵作成は保留する。次に`msinfo32`のOS名・システム製造元・システムモデルを読み取り、機種別の対応を調べる。TPMのクリア・初期化・更新やBIOS変更は行わない。[Microsoft公式のTPM確認方法](https://support.microsoft.com/en-us/windows/security/devicesecurity/enable-tpm-2-0-on-your-pc)／[システム情報ツール](https://learn.microsoft.com/ja-jp/windows-server/administration/windows-commands/msinfo32)
2. 読み取り結果を確認してから、そのWindows上に個別の非エクスポート鍵と公開CSRを1件作る。旧Windowsの固定名・固定フォルダの作成スクリプトをそのまま再利用しない。同じ要求を繰り返し作らず、秘密鍵・PFX・パスワードの受け渡しはしない。公開CSRは会社の既存メール等でMacへ渡す。このチャットへ会社PCからログインする必要はない。
3. 管理側でCSRの署名・公開鍵・用途を確認し、証明書を発行する。返すのは公開証明書だけ。Windowsでは同じユーザーの鍵へ関連付けを確認する。旧Windowsの実測を根拠にルート証明書追加や暗号設定変更を先行しない。
4. ローカル検証済みの入口コードと、専用Cloudflareの端末一覧・専用DBの端末行を整合させて追加する。既存2台の登録、元期限、予算台帳と保留は保持する。初期台帳移行SQLは再実行しない。端末許可の追加だけで全端末が停止しない順序を確認する。
5. 新Windowsで専用ショートカットからホーム・基本4画面を開く。固定ダミー文字列を未送信で入力→利用終了→再開して消去を確認する。最初の接続確認はAI呼び出しなし。既存端末の接続と無資格・直接URLの拒否も別に確認し、結果を記録する。

## 現在の実施範囲

- 入口コードをローカルで最大3台へ変更。1・2台の互換、3台の個別認可、未登録／不正／失効TLS拒否、3台目停止時に他2台を維持、4・5台設定や重複の拒否を架空データで検証した。Worker bundleもメモリ上で3台通過・未登録403・4台設定503を確認。対象の認証・bundle試験は62/62成功、skip0。
- 全自動試験は321件中319成功・失敗0・既定でloopback2件skip。その2件を含むTLS14件を明示して実行した初回はsandboxの127.0.0.1 listen EPERMで2件失敗。実行制限を外した同じTLS14件は14/14成功・skip0。外部providerはモックで、実Cloudflare／実Windowsの接続合格ではない。既存の非公開Worker artifactや初期台帳移行は変更していない。
- 新Windowsの本人報告はMicrosoft Windows 11 Pro / Dell Inc. / OptiPlex 9020、TPMは未検出。ブラウザとTPMの実搭載・有効化可否は未確認。CSR・秘密鍵・証明書は未作成、クラウド設定変更・配備は未実施。
- 今回の追加AI呼び出し0、契約・課金設定変更0。累計10 USD・未確定0.45 USD・2026-10-26 08:47:54 JSTを全3台で共有する。19:15 JST時点の先行集計を現在残高に流用せず、今回は費用台帳を再照会していない。
- 既存Macの接続安定性、OS再起動、実端末間の停止独立性等の残件は[先行報告](live-trial-preparation-20261020.md)のまま維持する。

## OptiPlex 9020の機種確認と次の読み取り

2026-10-21、本人から上記OS・機種名を受領し、DellとMicrosoftの一次資料を確認した。

- [Dell仕様書](https://i.dell.com/sites/doccontent/business/smb/merchandizing/en/Documents/Dell_OptiPlex_9020_with_Micro_Technical_Spec_Sheet.pdf)はTPM 1.2を記載し、地域によってTPMが提供されない旨の注記がある。機種名だけで当該個体の搭載を断定しない。
- [9020 SFF公式マニュアル](https://dl.dell.com/topicspdf/optiplex-9020-desktop_owners-manual_en-us.pdf)のp.30/34はF2でSystem Setupへ入り、SecurityのTPM SecurityでOSへのTPM表示を制御し、既定はDisabledとする。したがってBIOSで無効の可能性はあるが、現在の状態はまだ未実測。Activation/Deactivation/Clearの変更が直ちに反映される旨もあり、チェックやClear等には触らず表示だけ読む。
- [DellのTPM 1.2から2.0への公式アップグレード対応一覧](https://www.dell.com/support/kbdoc/en-us/000132583/dell-systems-that-can-upgrade-from-tpm-version-1-2-to-2-0)に9020は含まれていない。TPM 2.0への更新可とは案内しない。
- [Dellの9020対応OS一覧](https://www.dell.com/support/home/en-us/drivers/SupportedOS/optiplex-9020-desktop?c=cx&cs=19&l=en)にWindows 11は含まれていない。Windows 11が実際に稼働しているとの本人報告と、Dellのサポート対象は別で、TPMが有効になっても正式対応を証明しない。
- [MicrosoftのTPM用途別対応表](https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/tpm-recommendations)ではTPM Platform Crypto ProviderはTPM 1.2/2.0双方の対象だが、Windows 11はTPM 2.0を要求する。TPM 1.2の存在だけで、現OS上のRSA2048/SHA256鍵作成・署名・mTLS成功を保証しない。現在のアプリにTPM 2.0のattestationを実装済みとも扱わない。

次は新PCの作業を保存してから再起動し、DellロゴでF2、Security > TPM Securityの項目の有無と現在表示を読む。項目がなければその旨を記録し、パスワード要求や異なる画面なら進めない。チェック欄を変更せず、Save/Apply/Defaults/Clearを押さず終了する。BIOS変更・TPM初期化・firmware更新・ソフトウェア鍵への切替は未実施。表示を受領してから、TPM有効化を検討する場合のBitLocker・回復手段等への影響を確認する。

### F2で開けないとの本人報告

本人はF2を複数回押しても画面が開かないと報告した。起動時のキーボード認識・タイミング・起動モード等の原因は未確認。次は作業を保存し、Windowsの設定 > システム > 回復 > 詳細スタートアップから再起動、トラブルシューティング > 詳細オプション > UEFIファームウェアの設定 > 再起動という表示確認の経路を案内する。[Dell公式手順](https://www.dell.com/support/kbdoc/en-us/000126121/access-uefi-bios-system-setup-from-windows-on-your-dell-system)。UEFI項目がない場合は先へ進めず表示を受領する。LegacyからUEFIへの切替・ディスク変換・回復環境変更・BIOS更新は行わない。TPM設定には触らず、引き続き鍵・CSR・実環境の追加登録は未実施。

### TPM Securityの未チェックを本人確認

本人がTPM Security画面への到達と、チェックが入っていないことを報告した。BIOS側でTPMを有効にする設定が外れていることを確認できたが、当該個体のTPM版・稼働・署名互換性はまだ未確認。設定の変更・保存はまだ案内していない。

次は変更を保存せずWindowsへ戻り、スタートから「BitLockerの管理」を開き、OSドライブの状態表示を読み取る。[MicrosoftのBitLocker操作資料](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/operations-guide)。TPM変更時に回復キー要求が生じ得るため、有効化前に暗号化状態と必要な復旧手段を確認する。[Dell公式の事前確認](https://www.dell.com/support/kbdoc/en-us/000126121/access-uefi-bios-system-setup-from-windows-on-your-dell-system)。保護の一時停止・復号・TPM Clear・BIOS変更は未実施。回復キー自体はチャットやリポジトリへ収集しない。

### BitLocker無効の本人報告とTPM有効化の案内

本人がOSドライブのBitLocker画面で「BitLockerが無効」と確認した。独立したコマンド照合はしておらず、回復キーは収集していない。この結果を受け、Windowsの回復メニューからBIOSへ戻り、Security > TPM Securityの主チェック1件だけを有効にしてApply/Exitし、Windowsへ戻る手順を案内する。他のチェック・Clear・既存鍵の削除・初期化・firmware更新は行わない。予期しない削除や初期化の確認が出た場合は進めず文言を受領する。

次にWindowsで`tpm.msc`を開き、「状態」と「仕様バージョン」を本人が読み取る。有効化の実行、Windows起動、TPMの検出・準備完了はこの案内時点では回答待ちだった。後続の実測は次節を優先する。TPMが検出されてもRSA鍵・CSRの作成やmTLS互換性の成功は別の段階。今回のAI呼び出し・証明書発行・クラウド追加は0、元の予算・保留・期限を維持する。

### TPM 1.2を検出・使用準備未完了

有効化案内の後、本人がWindowsのTPM管理画面で「TPMは使用する準備ができていません」、仕様バージョン1.2と報告した。WindowsがTPM 1.2を検出したことは本人確認できたが、認証鍵を作れる準備完了には達していない。

次は管理者Windows PowerShellで次の読み取りだけを行い、Enabled/Activated/Owned/再起動待ち等を切り分ける。`Get-Tpm`の全項目をそのまま出さず、OwnerAuthを含まない項目へ限定する。[MicrosoftのGet-Tpm仕様](https://learn.microsoft.com/en-us/powershell/module/trustedplatformmodule/get-tpm?view=windowsserver2025-ps)

```powershell
Get-Tpm | Select-Object TpmPresent,TpmReady,TpmEnabled,TpmActivated,TpmOwned,RestartPending,AutoProvisioning,LockedOut | Format-List
```

上記の案内時点では実行結果待ちだった。後続の読み取りは次節を優先する。TPM Clear、所有者認証値の取得、初期化、firmware更新、鍵／CSR作成、クラウド登録、追加AIは行っていない。

### 状態の読み取り結果とWindowsの操作欄確認

本人から指定8項目の結果を受領した。

| 項目 | 本人の結果 |
|---|---|
| TpmPresent | True |
| TpmReady | False |
| TpmEnabled | False |
| TpmActivated | False |
| TpmOwned | False |
| RestartPending | False |
| AutoProvisioning | Enabled |
| LockedOut | False |

検出ありだが有効・アクティブ・所有・準備完了には達しておらず、再起動待ちやロックアウトも報告されていない。自動準備の設定がEnabledでも、実際の準備完了や失敗理由は証明しない。BIOS保存失敗・故障・Windowsによる自動無効化をこの結果だけで断定しない。

[Microsoft公式のTurn on the TPM手順](https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/initialize-and-configure-ownership-of-the-tpm#turn-on-the-tpm)に沿い、次は`tpm.msc`右側の「操作」に「TPMをオンにする／Turn TPM On」が表示されるかだけを読む。項目がなければ表示された項目名を受領する。現段階ではオン操作・準備・消去は実行せず、鍵作成も保留する。再度BIOSを確認する場合も、別項目のComputraceにあるActivateと混同しない。今回の調査・記録によるクラウド変更・追加AIは0、予算・保留・期限は維持。

### 「TPMを準備する」の表示を受領

本人から「TPMを準備する」は表示されるとの回答を受領。GUIの単押しが表示確認だけに留まることは確認できないため、まだGUI押下は案内していない。次は[Microsoft公式Initialize-Tpm](https://learn.microsoft.com/en-us/powershell/module/trustedplatformmodule/initialize-tpm?view=windowsserver2025-ps)の消去・物理存在要求の許可を両方Falseに明示した準備処理を、管理者Windows PowerShellで1回だけ実行する手順とする。

```powershell
Initialize-Tpm -AllowClear:$false -AllowPhysicalPresence:$false | Select-Object TpmReady,RestartRequired,ShutdownRequired,ClearRequired,PhysicalPresenceRequired | Format-List
```

これは読み取り専用ではなく、指定WindowsのTPMを利用可能にするための準備処理である。許可済みの当該PC追加の必要準備として、消去・物理存在コマンドの許可を付けずに進める。所有状態等が変わり得るため、非実行と混同しない。まだ本人の実行結果待ちで、準備完了・消去不要・既存鍵への影響なしを実測済みとは扱わない。結果またはエラーを受領するまで再実行・再起動・追加パラメータ指定は案内しない。ClearRequired=Trueや予期しない消去確認が出ても消去許可へ自動移行しない。既存2台、費用台帳、保留・期限、クラウド設定は今回変更しない。

### 非消去の準備結果と起動時確認要求

本人が上記コマンドの結果を報告した：TpmReady=False、RestartRequired=False、ShutdownRequired=False、ClearRequired=False、PhysicalPresenceRequired=True。この時点では消去要求も再起動要求も報告されず、本人がPC上で承認する物理確認が準備に必要と分かった。準備完了や将来も消去不要とは扱わない。

次は消去許可Falseを維持し、起動時の本人確認要求だけを許可する次の準備操作を1回案内する。準備・所有状態が変わり得る操作であり、読み取り専用ではない。[Initialize-Tpm公式仕様](https://learn.microsoft.com/en-us/powershell/module/trustedplatformmodule/initialize-tpm?view=windowsserver2025-ps)／[準備処理の物理確認と消去の区別](https://learn.microsoft.com/en-us/windows/win32/secprov/win32-tpm-provision)

```powershell
Initialize-Tpm -AllowClear:$false -AllowPhysicalPresence:$true | Select-Object TpmReady,RestartRequired,ShutdownRequired,ClearRequired,PhysicalPresenceRequired | Format-List
```

この次操作はまだ本人結果待ち。5項目またはエラーを受領するまで再起動・シャットダウン・消去や再実行へ進めない。起動が必要になる場合は、消去を含まない保留要求／画面であることを別途確認してから案内する。物理確認の省略設定やPPI overrideは変更しない。新PCの鍵・CSR・証明書はまだなく、クラウド追加・追加AI・契約／予算／期限変更は0。

### 再起動要求と保留操作の読み取り

本人がPPI許可版の実行結果を報告した：TpmReady=False、RestartRequired=True、ShutdownRequired=False、ClearRequired=False、PhysicalPresenceRequired=True。準備完了ではなく、再起動が必要な段階。ClearRequired=Falseは今回の結果で、将来の無条件な非消去保証へ広げない。

次は同じ管理者PowerShellで保留操作を読む。[MicrosoftのGetPhysicalPresenceRequest仕様](https://learn.microsoft.com/en-us/windows/win32/secprov/getphysicalpresencerequest-win32-tpm)

```powershell
Get-CimInstance -Namespace root/cimv2/security/microsofttpm -ClassName Win32_Tpm | Invoke-CimMethod -MethodName GetPhysicalPresenceRequest | Select-Object ReturnValue,Request
```

ReturnValue=0かつRequest=6（Enable+Activate）または10（Enable+Activate+所有者導入を許可）の場合だけ、作業保存後の通常再起動へ進める。その他の番号、空出力、エラーでは再起動せず結果を受領する。再起動しても承認キーを押す前にTPM確認画面の文言を受領し、Clear/消去に同意しない。確認画面が出ずWindowsへ戻った場合もその事実を記録し、失敗・故障を即断しない。保留要求の読み取り・再起動・起動時の承認は現時点で未実施。追加AI・クラウド変更・予算／期限変更0。

### 起動時の画像確認と操作番号の未照合

本人が起動時の画面写真を提示した。画像ではTPMのEnable/Activateに加え、一時的な無効化を許すOperator認証値の作成許可を求め、F10で承認、Escで要求を拒否して継続する表示がある。Clear/消去の表示は見当たらない。Windowsの再起動と当該画面への到達は写真で確認できたが、直前のReturnValue/Requestの数値はまだ受領していない。写真だけから番号6/10との照合済み、あるいはEnable/Activateのみの操作とは記録しない。

[TCG PPI仕様](https://trustedcomputinggroup.org/wp-content/uploads/Physical_Presence_Interface_1-20_0-100.pdf)はEnable/Activate/所有者導入許可とOperatorAuth設定を区別する。写真の追加文言を無変更・追加権限なしと扱わず、承認前に以前の操作番号と照合する。本人へF10をまだ押さず、直前のReturnValueとRequestの数値を教えるよう案内する。結果が残っていなければ画像に記載されたEscで拒否してWindowsへ戻る。F10承認やTPM準備完了、Windows起動後の状態はまだ未確認。鍵作成・クラウド追加・追加AI・予算／期限変更は0。

### Request 10の本人照合とF10の案内

本人が再起動前のReturnValue=0、Request=10を明示し、F10で進めてよいか確認した。[Microsoftの操作番号定義](https://learn.microsoft.com/en-us/windows/win32/secprov/getphysicalpresencerequest-win32-tpm)では10はEnable/Activate/所有者導入許可で、Clearを含む番号ではない。これにより以前の数値照合条件は本人報告として満たした。

画面のOperatorAuthの作成許可は追加の作用としてすでに本人へ説明している。今回の指定Windowsの通常TPM準備の範囲で、写真の有効化・アクティブ化・一時停止用認証値の作成許可を含む操作としてF10を1回押すよう案内する。画面文言とTCGの操作10/13が規格上同じだと証明したものではなく、Enable/Activateだけと省略して説明しない。別のClear/消去/削除確認が出た場合は承認せず停止する。

F10の実行とWindows起動後の状態はまだ本人の結果待ち。起動後に`tpm.msc`の状態を読み、準備完了を確認してから鍵作成へ進む。予算・保留・期限・既存2台・クラウド設定・追加AIは変更なし。

### メンテナンス表示から準備完了へ

F10案内の後、本人はWindowsのTPM管理画面でメンテナンスタスク実行中の表示を報告した。その後「TPMは使用する準備ができています」へ変化したと報告。Windows画面の本人確認として準備完了を記録する。Get-Tpmの最新8項目、PPI実行結果番号、署名やChrome接続を独立検証したものではなく、TPM 2.0への変更・Windows 11のメーカー正式対応を意味しない。途中で追加の消去・再初期化コマンドは案内していない。

次に、そのPCで普段Chromeを使うWindowsユーザーの通常PowerShellで、個別の非エクスポートTPM RSA2048/SHA256鍵と公開CSRを1件だけ作る。管理者PowerShellで別ユーザーの鍵を作らない。新CNは`Yamadaya-trial-Windows2-20261021`、新フォルダはDesktopの`Yamadaya-AI-device-request-2-20261021`。既存フォルダ／同名の個人証明書／申請があれば停止し、certreq失敗時も削除や再実行で別鍵を作らない。Microsoft Platform Crypto Providerを固定し、ソフトウェア鍵へ切り替えない。

配布用コマンドをローカルの`handoff/windows-2-20261021/01-create-public-request.txt`へ用意した。現在はテキストの整合と停止条件を静的確認したのみで、Windows実行・PowerShellパーサー検証は未実施。コマンドは鍵とCSRを作る変更操作であり、読み取り専用ではない。[certreqの公式仕様](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/certreq_1)

成功時は公開CSRを表示し、元CSRをバイト変更せず`windows2-public-request.txt`へコピーする。本人が既存メール等でその公開ファイルだけをMacへ渡し、MacからBEGIN〜ENDの本文を提示する。会社PCへこのChatGPT/Codexや私用Googleアカウントを接続する必要はない。秘密鍵・PFX・パスワードは移送しない。MacでCSR署名・CN・RSA2048/SHA256・要求用途を検証してから証明書発行へ進む。

鍵・CSRの実作成と受領はまだ未実施。CSR成功だけで非エクスポート性の実測、PSS、TLS 1.3、Chrome接続の合格にしない。クラウド追加・追加AI・予算／期限変更0。費用台帳と既存2台も維持。

### 公開CSRの受領と署名検証

本人が新Windowsで作った公開申請ファイルをMacから添付した。OpenSSL `req -verify`がverify OKとなり、Subjectが予定の新Windows用CNに一致した。RSA2048、sha256WithRSAEncryption、要求されたcritical digitalSignatureのみ・critical CA=false・TLS Web Client Authentication、およびSANの要求なしを確認した。公開CSRを変更せずGit対象外の非公開領域へ0600で保存し、検証結果とCSR／公開鍵のハッシュを管理用記録へ残した。CSR本文・実ハッシュ・申請属性の端末情報は公開資料へ転載しない。

有効な署名付きCSRの受領により公開鍵と署名の整合は確認できたが、CSRだけでMicrosoft Platform Crypto Providerや非エクスポート属性を独立検証したものではない。TPMアテステーション、PSS署名、TLS 1.3、Chromeの接続も未試験。秘密鍵・PFX・パスワードは受領していない。

Cloudflareで証明書発行を進めるためChromeへ接続したが、セッション操作が応答せず、Cloudflareの発行画面やフォーム送信へ到達していない。同じ操作を繰り返さず停止した。新しい証明書は未発行で、Worker・WAF・DBの端末許可も未変更。接続が復旧した後、検証済みCSRへの署名、公開証明書の検査、最大3台対応Workerの先行反映、既存2台を保持した許可追加、Windowsへの公開証明書返却の順で進める。アプリの元期限は証明書自体の有効期間と別に維持する。

今回の追加AI・追加契約・費用台帳の変更は0。累計10 USD・未確定0.45 USD・2026-10-26 08:47:54 JSTは変更していない。Windows側の再作成・TPM再準備は不要で、次は管理側での証明書発行段階。

### 3台の管理側登録とWindowsへの返却準備

本人がChrome拡張を開いた後も、拡張経由のセッション操作は応答しなかった。一方、CUAのネイティブChrome操作で既存のCloudflare管理画面を操作できた。発行フォームに検証済み公開CSRと最短1年を入力し、発行・非公開保存・専用入口と専用DBへの指定1台追加について実行直前の明示承認を受領した。1年の証明書期間とは別に、アプリの元期限を維持する承認である。

| 対象 | 実施・確認結果 |
|---|---|
| 新Windowsの公開証明書 | Cloudflare Managed CAから1枚発行、一覧で既存2枚と合わせ3枚Active。固有CN、CSRとのSPKI完全一致、RSA2048、clientAuth、CA=false、現在の有効期間を親・独立担当で確認。KU拡張は既存と同じく省略。発行CAの証明書が同梱されていないため署名チェーンの独立検証は未実施で、OSのRoot信頼は追加していない |
| 入口コード | bundle差分は最大2台から3台への上限とエラー文だけ。編集画面からコピーした全文を検証済みファイルと照合し、末尾改行以外の一致とJavaScript構文検査を確認。認証／bundle試験62/62を再実行後に反映し、Cloudflareで新バージョンActiveとVersion savedを確認 |
| 入口の型診断と操作中の停止 | 更新前から4件あった型推論診断は構文エラーと区別した。初回のDeployは自動レビューで全文未照合・4診断を理由に停止し、全文照合と試験で懸念を解消してから反映。後続の画面遷移時に未保存エディタへURLが混入したが、その入力を反映せず、検証済みソースへ明示的に戻して画面離脱時に破棄。稼働版へ誤入力は配備していない |
| Worker許可一覧 | 既存2件のID／指紋と保存済み一覧の一致を確認してから、新Windowsの1件だけを追加してDeploy。署名秘密・送信先・他設定は変更なし |
| WAF | 専用試用ホストの既存Blockルールだけで指紋を3件へ追加。証明書検証成功・未失効・正規指紋の条件を保持し、画面でRule validation passedとActiveを確認。既存の診断ルールはDisabledのまま。業務ホスト・DNS・TLS全体設定は変更なし |
| 専用trial DB | 対象projectを照合し、新クエリの全文一致を確認して実行。5秒の制限とtransaction内検査付きで新端末1行だけINSERT。既存2行全列、予算全列、全ジョブ全列の前後同値、元予算・期限・unknown3件0.45 USDの照合に成功。移行処理・権限・資格情報・既存業務DBは変更なし |
| 拒否試験 | 証明書なし、証明書なし＋偽装端末ヘッダー、Vercel直接URLの実GET各1件がすべて403。最初のsandbox内試行はDNS失敗でHTTP未到達だったため合格に数えず、ネットワーク許可後の3件と区別した。AI送信なし |
| Windowsへの返却 | 公開CERと取込コマンドTXTだけのZIPをローカルhandoffへ作成。DERのファイルハッシュ／CN／指紋一致とZIP内2件のバイト一致を独立確認。秘密鍵・PFX・パスワードなし。公開物のGit許可リストには含めない |

DB追加処理は先に隔離PGliteのダミーデータで13/13に合格した。正常追加、再実行拒否、既存差分・予算／期限／元保留の異常拒否、trigger副作用時のロールバックを検査した。これは新Windowsでの実行試験ではない。

実DB登録時の集計は上限10 USD、予約合計4.445000 USD、usage計算額0.199437 USD、39ジョブ、sending＋unknown合計3件、元unknown保留0.45 USD、paused=false。予約を差し引いた保守的な残り枠は5.555000 USD。実請求額や残高ではない。今回の追加操作でAIは実行しておらず、古い集計から増えた全処理の機能・端末・内容をこの集計だけで特定していない。元unknownは集計だけでなく登録SQL内で元snapshotのID／hold／request_hashと対応する3行を照合し、保持を確認した。

次は本人がZIPを新Windowsへ渡し、CSR作成時と同じ普段のユーザーで取込コマンドを実行する。コマンドは元要求フォルダとCERのハッシュ・CN・指紋を確認し、CurrentUser Myへの追加、新証明書だけのTPM鍵対応、HasPrivateKey、Provider、ExportPolicy=Noneを確認する。鍵作成・書出し・Root追加・レジストリ変更は含まない。現時点では静的レビューのみでWindows未実行。新端末の証明書取込、TPM Provider／非export属性の実読取、Chrome接続、無操作利用は未確認。既存Mac／Windowsの正規接続も今回の否定試験から合格にしない。追加契約・増額・期限延長なし。

### 新Windowsの取込成功とホーム接続の案内

本人が`WINDOWS2_CERTIFICATE_READY`と表示されたと報告した。この出力は配布したガード付きコマンドで、CERのハッシュ・CN・指紋、CurrentUser Myへの追加、対象TPM鍵の関連付け、HasPrivateKey、Microsoft Platform Crypto Provider、ExportPolicy=Noneの検査を通過した際に出る。本人の成功報告として記録し、Windowsの画面や鍵属性をこちらで独立観測したものとはしない。TPMアテステーション・追加の署名試験・TLS接続・実際の通信方式は未確認。

次は既存会社PCでホーム成功を確認した専用Chrome方式を、新Windows専用のTempプロファイル名で案内する。Windowsキー＋Rへ渡す1行をローカルhandoffの`04-open-trial-chrome.txt`へ用意した。`--user-data-dir`は新PC用の固有名、`--no-first-run`／`--no-default-browser-check`、`--disable-quic`、TLS 1.2 min/max、`--new-window`、固定の試用HTTPSホストだけを指定する。新しいChromeプロファイルは作成されるが、通常プロファイル・証明書検証・Root信頼・Chromeポリシー・WARP設定は変更しない。先行PCの成功を、このPCの接続成功や実通信方式の合格へ流用しない。

独立レビュー後、Tempの環境変数を確実に展開するため、起動行は`cmd.exe /d /c start ""`から始める239文字とした。`/d`でcmdのAutoRunを使わず、`start`の空の題名とChrome引数を分ける。Windowsでの実行結果はまだ未受領で、起動成功や実際のプロファイル位置を静的レビューだけで合格にしない。

初回に証明書選択が出た場合は新Windows用の固有CN1件を選ぶ。証明書なしの選択・別証明書への切替・セキュリティ警告の回避は案内しない。ホームの表示またはエラーを受領するまで生成・チャット送信は行わない。今回の案内・記録による追加AIとクラウド設定変更は0、元予算・保留・期限を維持する。

### 新Windowsの初回接続エラー

本人が「このサイトにアクセスできません」と報告した。ChromeのERRコード、実際のアドレス、起動引数、証明書選択の有無はまだ未受領。ホーム接続は未合格として扱い、この汎用表示からDNS障害・証明書不備・TPM故障・サーバー停止を断定しない。

並行してMacから公開DNSのA/AAAA解決と、証明書なしのHTTPS GET1件で403・サーバー証明書の検証成功を確認した。Cloudflareまでの応答確認であり、新Windowsからの経路や登録済み端末の正常接続・アプリ全体の稼働確認ではない。起動用テキストの原本も独立して静的再確認し、239文字のASCII、引用、Temp変数、固定URLに構文上の欠陥は見つからなかったが、本人側の受渡し文字列との一致は未確認。

次は本人からERRコードとURLを受領して診断を選ぶ。現時点では接続を自動再試行せず、鍵再作成・TPM操作・Root信頼・Chromeポリシー・WARP・クラウド設定の変更を行わない。追加AI0、元予算・保留・期限を維持する。

### PowerShell経由の起動成功と利用終了の確認

本人が「ごめん、PowerShellからやったらできた」と先行報告を訂正した。PowerShell経由で開けたという実機の本人報告として記録する。画面・実URL・起動引数・実通信方式は独立観測していない。Run画面のエラーコードも未受領なので、引用・変数展開等の特定原因を修正済みとは扱わず、今回成功したPowerShell経由を基準にする。

次は同じ専用Chromeで文章作成へ固定ダミー文字列を未送信で入力し、「利用終了」後に成功したPowerShellの起動方法で再開して、ホーム表示と入力消去を本人確認する。生成物やダウンロード済みファイルの削除、サーバーの全データ削除、OS再起動、各AI機能の成功へこの確認を拡張しない。確認が通った後に専用ショートカットと使い勝手の試験へ進む。今回の追加AI・クラウド設定変更は0、元予算・保留・期限を維持する。

### 新Windowsの利用終了成功とショートカット準備

本人が「ホームも開けたし、入力も消えてた」と報告した。案内した未送信の文章入力→利用終了→同じPowerShell経由で再開する手順に対する実機の本人確認として、ホーム再表示と未送信入力の消去を成功と記録する。実画面や通信方式の独立観測ではなく、生成結果・ダウンロード済みファイル・サーバー保存内容の削除やOS再起動後の確認でもない。

次はローカルhandoffの`05-create-desktop-shortcut.txt`を同じ通常Windowsユーザーへ渡し、デスクトップへ「やまだやAI（試用）」のショートカットを1件だけ作る。元の専用Tempプロファイルと新Windows証明書の存在を確認し、プロファイルがなければ別プロファイルを自動作成せず停止する。DesktopDirectoryと実在する標準Chromeの候補が1件だけであることも検査し、既存の同名ショートカットは上書きしない。実行ファイル・引数・作業フォルダ・アイコンを分けて保存し、読み戻して一致した場合だけ成功を表示する。

起動引数は成功した専用プロファイル名と既知のフラグ・固定HTTPSホストを保持する。コマンド自体はChromeを自動起動せず、本人が作成後にダブルクリックしてホームを確認する。現時点では準備・静的確認のみで、新Windowsでのショートカット作成・起動は未実施。鍵・Root信頼・レジストリ・WARP・クラウド設定・費用台帳の変更や追加AIは0。Tempプロファイル方式の恒久運用・OS再起動・端末別停止・新Windowsの基本4機能の実AI試験は残る。

### 新Windowsのショートカット成功と実利用試験への移行

本人が「ショートカットからホーム開けた」と報告した。専用ショートカットでの再開成功を実機の本人確認として記録する。前段の証明書取込・専用起動・利用終了後の未送信入力消去と合わせ、追加PCの接続準備は完了した。実画面、ショートカットの保存値やTLS版を独立観測したものではなく、新Windowsでの基本4機能・PDF・実印刷・OS再起動・端末別停止の独立性は未確認。

実利用の案内前に、専用trialの最小権限DB接続でusageのみを1回照会し、短いtransactionの後にROLLBACKした。予算行ロックがあるため厳密なREAD ONLY transactionとは呼ばない。10月21日10:50:42 JSTの結果は上限10 USD、全予約4.445000 USD、usage計算費用0.199437 USD、39ジョブ、sending＋unknown合計3件、imported=true、paused=false、期限2026-10-26 08:47:54 JST。予約を差し引いた保守的な残り枠は5.555000 USDで、OpenAI残高・実請求額ではない。今回のusage集計は個別unknownの再照合を含まず、管理側登録時に照合した元3件0.45 USDの保持条件を変更しない。追加AI・コミットされるデータ変更・クラウド設定変更は0。

次は設定を追加の前提にせず、同じショートカット窓からダミー商品のA4縦POPを1枚、情報入力→提案の内容・価格・向きの確認→画像生成1回→PDF保存と表示まで本人が試す。検索は使わず、累計10 USD・元期限・元unknown保留と、新unknown時は全端末の新規送信を停止／元処理を再送しない条件を維持する。結果受領までは新WindowsのPOP／PDFを合格にしない。POPの後にチャット・文章作成・一般画像の使い勝手も確認できる段階であり、これらの新端末での成功はまだ未実施。

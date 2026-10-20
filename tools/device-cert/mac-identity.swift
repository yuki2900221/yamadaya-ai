// Local, offline preparation helper. No network calls and no private-key export.
// Persistent Keychain changes occur only with --prepare or --install.
import Foundation
import Security
import CryptoKit

let deviceCN = "Yamadaya-trial-Mac-20261019"
let keyTag = Data("com.superyamadaya.ai-mock.mac.20261019.v1".utf8)
let keyLabel = "Yamadaya AI mock Mac 20261019"
let originalTrialDeadline = "2026-10-26T08:47:54+09:00"

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw Failure(message) }
}
func checkOS(_ status: OSStatus, _ operation: String) throws {
    if status != errSecSuccess { throw Failure("\(operation) failed (OSStatus \(status))") }
}

enum DER {
    static func wrap(_ tag: UInt8, _ value: [UInt8]) -> [UInt8] {
        let count = value.count
        let length: [UInt8]
        if count < 128 { length = [UInt8(count)] }
        else {
            var number = count, bytes: [UInt8] = []
            while number > 0 { bytes.insert(UInt8(number & 255), at: 0); number >>= 8 }
            length = [0x80 | UInt8(bytes.count)] + bytes
        }
        return [tag] + length + value
    }
    static func seq(_ pieces: [[UInt8]]) -> [UInt8] { wrap(0x30, pieces.flatMap { $0 }) }
    static func set(_ pieces: [[UInt8]]) -> [UInt8] { wrap(0x31, pieces.flatMap { $0 }) }
    static func oid(_ bytes: [UInt8]) -> [UInt8] { wrap(0x06, bytes) }
    static func bits(_ bytes: [UInt8]) -> [UInt8] { wrap(0x03, [0] + bytes) }
    static func octets(_ bytes: [UInt8]) -> [UInt8] { wrap(0x04, bytes) }
    static let rsa: [UInt8] = [0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01]
    static let sha256RSA: [UInt8] = [0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0b]
    static let clientAuth: [UInt8] = [0x2b,0x06,0x01,0x05,0x05,0x07,0x03,0x02]
    static let extensionRequest: [UInt8] = [0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x09,0x0e]
    static let commonName: [UInt8] = [0x55,0x04,0x03]
    static let signatureAlgorithm = seq([oid(sha256RSA), [0x05,0x00]])
    static func name(_ cn: String) -> [UInt8] {
        seq([set([seq([oid(commonName), wrap(0x0c, Array(cn.utf8))])])])
    }
    static func extensions(ca: Bool = false, includeClientAuth: Bool = true,
                           keyUsage: [UInt8]? = [7,0x80]) -> [UInt8] {
        let constraints = ca ? seq([[0x01,0x01,0xff]]) : seq([])
        var values = [
            seq([oid([0x55,0x1d,0x13]), [0x01,0x01,0xff], octets(constraints)])
        ]
        if let keyUsage {
            values.append(seq([oid([0x55,0x1d,0x0f]), [0x01,0x01,0xff], octets(wrap(0x03, keyUsage))]))
        }
        if includeClientAuth {
            values.append(seq([oid([0x55,0x1d,0x25]), octets(seq([oid(clientAuth)]))]))
        }
        return seq(values)
    }
}

struct TLV {
    let tag: UInt8
    let value: [UInt8]
    let encoded: [UInt8]
    static func read(_ bytes: [UInt8], _ cursor: inout Int) throws -> TLV {
        let start = cursor
        try require(cursor + 2 <= bytes.count, "Truncated DER")
        let tag = bytes[cursor]; cursor += 1
        try require(tag & 0x1f != 0x1f, "Unsupported high-tag DER")
        let first = bytes[cursor]; cursor += 1
        var length = Int(first)
        if first & 0x80 != 0 {
            let count = Int(first & 0x7f)
            try require(count > 0 && count <= 4 && cursor + count <= bytes.count, "Invalid DER length")
            try require(bytes[cursor] != 0, "Noncanonical DER length")
            length = 0
            for byte in bytes[cursor..<cursor+count] { length = (length << 8) | Int(byte) }
            cursor += count
            try require(length >= 128, "Noncanonical long DER length")
        }
        try require(length <= 65536 && cursor + length <= bytes.count, "DER value too large or truncated")
        let value = Array(bytes[cursor..<cursor+length]); cursor += length
        return TLV(tag: tag, value: value, encoded: Array(bytes[start..<cursor]))
    }
    static func one(_ bytes: [UInt8]) throws -> TLV {
        var cursor = 0
        let result = try read(bytes, &cursor)
        try require(cursor == bytes.count, "Trailing DER data")
        return result
    }
    func children() throws -> [TLV] {
        var cursor = 0, result: [TLV] = []
        while cursor < value.count {
            try require(result.count < 128, "Too many DER elements")
            result.append(try TLV.read(value, &cursor))
        }
        return result
    }
}

func copyPublic(_ privateKey: SecKey) throws -> SecKey {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else { throw Failure("Cannot get public key") }
    return publicKey
}
func publicBytes(_ key: SecKey) throws -> [UInt8] {
    // Callers pass public keys only. Never call this with a private key.
    guard let attributes = SecKeyCopyAttributes(key) as? [String: Any],
          let keyClass = attributes[kSecAttrKeyClass as String] as? String,
          keyClass == (kSecAttrKeyClassPublic as String) else { throw Failure("Public-key export guard failed") }
    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(key, &error) else { throw Failure("Cannot encode public key") }
    return Array(data as Data)
}
func ensureNotExtractable(_ key: SecKey) throws {
    // Never print, serialize, or return this dictionary. Inspect only the Boolean.
    guard let attrs = SecKeyCopyAttributes(key) as? [String: Any],
          let extractable = attrs[kSecAttrIsExtractable as String] as? Bool,
          extractable == false else { throw Failure("Non-extractable key verification failed; do not issue a certificate") }
}
func sign(_ bytes: [UInt8], _ key: SecKey) throws -> [UInt8] {
    var error: Unmanaged<CFError>?
    guard let result = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256,
                                           Data(bytes) as CFData, &error) else {
        throw Failure("Keychain signature failed (no private-key export attempted)")
    }
    return Array(result as Data)
}
func spki(_ privateKey: SecKey) throws -> [UInt8] {
    DER.seq([DER.seq([DER.oid(DER.rsa), [0x05,0x00]]), DER.bits(try publicBytes(copyPublic(privateKey)))])
}
func makeCSR(_ key: SecKey) throws -> [UInt8] {
    let requestedExtensions = DER.seq([DER.oid(DER.extensionRequest), DER.set([DER.extensions()])])
    let info = DER.seq([[0x02,0x01,0x00], DER.name(deviceCN), try spki(key), DER.wrap(0xa0, requestedExtensions)])
    return DER.seq([info, DER.signatureAlgorithm, DER.bits(try sign(info, key))])
}
func pem(_ der: [UInt8], _ label: String) -> Data {
    let base64 = Data(der).base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
    return Data("-----BEGIN \(label)-----\n\(base64)\n-----END \(label)-----\n".utf8)
}
func certificateDER(_ data: Data) throws -> [UInt8] {
    try require(data.count > 0 && data.count <= 65536, "Certificate file must be 1..65536 bytes")
    if let text = String(data: data, encoding: .utf8), text.contains("-----BEGIN") {
        let start = "-----BEGIN CERTIFICATE-----", end = "-----END CERTIFICATE-----"
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        try require(trimmed.hasPrefix(start) && trimmed.hasSuffix(end), "Expected one certificate PEM; no keys or chain bundles")
        let middle = trimmed.dropFirst(start.count).dropLast(end.count)
        let body = middle.filter { !$0.isWhitespace }
        guard let decoded = Data(base64Encoded: String(body)) else { throw Failure("Invalid certificate PEM") }
        return Array(decoded)
    }
    return Array(data)
}
func dateValue(_ node: TLV) throws -> Date {
    try require(node.tag == 0x17 || node.tag == 0x18, "Invalid certificate time tag")
    guard let value = String(bytes: node.value, encoding: .ascii) else { throw Failure("Invalid certificate time") }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.isLenient = false
    formatter.dateFormat = node.tag == 0x17 ? "yyMMddHHmmss'Z'" : "yyyyMMddHHmmss'Z'"
    // RFC 5280 UTCTime 50..99 is 1950..1999, 00..49 is 2000..2049.
    formatter.twoDigitStartDate = Date(timeIntervalSince1970: -631152000)
    guard value.hasSuffix("Z"), let date = formatter.date(from: value) else { throw Failure("Unsupported certificate time") }
    return date
}
struct CertificateMetadata {
    let certificate: SecCertificate
    let cn: String
    let notAfter: Date
    let fingerprint: String
}
func validateCertificate(_ bytes: [UInt8], _ key: SecKey, now: Date = Date()) throws -> CertificateMetadata {
    let root = try TLV.one(bytes)
    try require(root.tag == 0x30, "Certificate must be a DER sequence")
    let outer = try root.children()
    try require(outer.count == 3 && outer[0].tag == 0x30, "Invalid certificate structure")
    let tbs = try outer[0].children()
    try require(tbs.count >= 8 && tbs[0].tag == 0xa0 && tbs[0].value == [0x02,0x01,0x02], "Expected X.509 v3 certificate")
    let validity = try tbs[4].children()
    try require(validity.count == 2, "Invalid validity interval")
    let notBefore = try dateValue(validity[0]), notAfter = try dateValue(validity[1])
    try require(notBefore <= now && now < notAfter, "Certificate is not currently valid")
    var names: [String] = []
    try require(tbs[5].tag == 0x30, "Invalid subject")
    for rdn in try tbs[5].children() {
        try require(rdn.tag == 0x31, "Invalid RDN")
        for attribute in try rdn.children() {
            let pair = try attribute.children()
            try require(attribute.tag == 0x30 && pair.count == 2 && pair[0].tag == 0x06, "Invalid subject attribute")
            if pair[0].value == DER.commonName {
                try require(pair[1].tag == 0x0c || pair[1].tag == 0x13, "Unsupported CN encoding")
                guard let name = String(bytes: pair[1].value, encoding: .utf8) else { throw Failure("Invalid CN") }
                names.append(name)
            }
        }
    }
    try require(names == [deviceCN], "Certificate CN does not match this trial Mac")
    let extensionWrappers = tbs.dropFirst(7).filter { $0.tag == 0xa3 }
    try require(extensionWrappers.count == 1, "Expected one extensions field")
    let extensions = try TLV.one(extensionWrappers[0].value)
    try require(extensions.tag == 0x30, "Invalid extensions sequence")
    // RFC 5280 §§4.2.1.3/4.2.1.12: KU restricts usage when present;
    // EKU clientAuth remains mandatory for this application even if KU is absent.
    var seen = Set<[UInt8]>(), caFalse = false, keyUsageAllowsClientSignature = true, clientAuth = false
    for item in try extensions.children() {
        let parts = try item.children()
        try require(item.tag == 0x30 && (parts.count == 2 || parts.count == 3) && parts[0].tag == 0x06, "Invalid extension")
        let oid = parts[0].value
        try require(seen.insert(oid).inserted, "Duplicate certificate extension")
        let critical: Bool
        if parts.count == 3 {
            try require(parts[1].tag == 0x01 && parts[1].value.count == 1, "Invalid critical flag")
            critical = parts[1].value[0] != 0
        } else { critical = false }
        guard let wrapped = parts.last, wrapped.tag == 0x04 else { throw Failure("Invalid extension payload") }
        let ext = try TLV.one(wrapped.value)
        switch oid {
        case [0x55,0x1d,0x13]:
            try require(ext.tag == 0x30, "Invalid basic constraints")
            let constraints = try ext.children()
            // A leaf must not contain CA=true or a path length constraint.
            caFalse = constraints.isEmpty || (constraints.count == 1 && constraints[0].tag == 0x01 && constraints[0].value == [0])
        case [0x55,0x1d,0x0f]:
            try require(ext.tag == 0x03 && ext.value.count >= 2 && ext.value[0] <= 7, "Invalid key usage")
            keyUsageAllowsClientSignature = ext.value[1] & 0x80 != 0 && ext.value[1] & 0x06 == 0
        case [0x55,0x1d,0x25]:
            try require(ext.tag == 0x30, "Invalid extended key usage")
            clientAuth = try ext.children().contains { $0.tag == 0x06 && $0.value == DER.clientAuth }
        default:
            // Known non-critical metadata is harmless; unknown critical extensions are rejected.
            try require(!critical, "Unsupported critical certificate extension")
        }
    }
    try require(caFalse && keyUsageAllowsClientSignature && clientAuth,
                "Expected CA=false, clientAuth, and signing-compatible keyUsage when present")
    guard let certificate = SecCertificateCreateWithData(nil, Data(bytes) as CFData),
          let publicKey = SecCertificateCopyKey(certificate) else { throw Failure("Security framework rejected certificate") }
    try require(try publicBytes(publicKey) == publicBytes(copyPublic(key)), "Certificate public key does not match the existing Keychain key")
    let hash = SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined()
    return CertificateMetadata(certificate: certificate, cn: deviceCN, notAfter: notAfter, fingerprint: hash)
}

func findPrivateKey() throws -> SecKey? {
    let query: [CFString: Any] = [kSecClass: kSecClassKey, kSecAttrKeyClass: kSecAttrKeyClassPrivate,
                                kSecAttrApplicationTag: keyTag, kSecReturnRef: true, kSecMatchLimit: kSecMatchLimitOne]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    try checkOS(status, "Find exact trial key")
    guard let item, CFGetTypeID(item) == SecKeyGetTypeID() else { throw Failure("Unexpected Keychain result") }
    return (item as! SecKey)
}
func generateKey(persistent: Bool) throws -> SecKey {
    // Use the platform's RSA capabilities. Supplying a partial legacy usage mask
    // can make generation itself fail with errSecKeyUsageIncorrect (-67731).
    // The issued leaf certificate still requires digitalSignature/clientAuth.
    var privateAttributes: [CFString: Any] = [kSecAttrIsPermanent: persistent]
    if persistent {
        privateAttributes[kSecAttrApplicationTag] = keyTag
        privateAttributes[kSecAttrLabel] = keyLabel
    }
    // Selftest uses the in-memory modern key implementation, with no Keychain IO.
    // A legacy default-keychain generation even with minimal parameters failed
    // under the test sandbox; this does not establish a particular attribute cause.
    // The real persistent preparation MUST request and verify nonextractability.
    var attributes: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048,
                                     kSecPrivateKeyAttrs: privateAttributes]
    if persistent { attributes[kSecAttrIsExtractable] = false }
    else { attributes[kSecUseDataProtectionKeychain] = true }
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
        let code = error.map { CFErrorGetCode($0.takeRetainedValue()) } ?? 0
        throw Failure("Key generation failed (code \(code))")
    }
    if persistent { try ensureNotExtractable(key) }
    return key
}
func printMetadata(_ value: CertificateMetadata) {
    let formatter = ISO8601DateFormatter()
    print("certificate_cn=\(value.cn)")
    print("certificate_sha256=\(value.fingerprint)")
    print("certificate_not_after=\(formatter.string(from: value.notAfter))")
    print("original_trial_deadline=\(originalTrialDeadline)")
}
func prepare(_ path: String) throws {
    try require(!FileManager.default.fileExists(atPath: path), "CSR output already exists; refusing overwrite")
    try require(try findPrivateKey() == nil, "Trial key already exists; refusing replacement or duplicate generation")
    let key = try generateKey(persistent: true)
    // Only a PUBLIC CSR is written. If writing fails, retain the key; do not generate a duplicate.
    try pem(makeCSR(key), "CERTIFICATE REQUEST").write(to: URL(fileURLWithPath: path), options: .withoutOverwriting)
    print("created_nonextractable_rsa2048_key=true")
    print("csr_saved=\(path)")
    print("certificate_cn=\(deviceCN)")
    print("next=Submit only this public CSR to the Cloudflare managed CA; do not export the key")
}
func install(_ path: String) throws {
    guard let key = try findPrivateKey() else { throw Failure("Prepare this Mac key first; never import a foreign private key") }
    try ensureNotExtractable(key)
    let certificate = try validateCertificate(certificateDER(Data(contentsOf: URL(fileURLWithPath: path))), key)
    // This adds a leaf certificate, never a trusted CA or private key. No trust settings or ACL changes.
    let status = SecItemAdd([kSecClass: kSecClassCertificate, kSecValueRef: certificate.certificate,
                             kSecAttrLabel: keyLabel] as CFDictionary, nil)
    if status != errSecDuplicateItem { try checkOS(status, "Add public leaf certificate") }
    var identity: SecIdentity?
    try checkOS(SecIdentityCreateWithCertificate(nil, certificate.certificate, &identity), "Match certificate to existing private key")
    guard let identity else { throw Failure("Identity not found after certificate install") }
    var matchedKey: SecKey?
    try checkOS(SecIdentityCopyPrivateKey(identity, &matchedKey), "Check matched identity")
    guard let matchedKey else { throw Failure("Matched identity has no key") }
    try ensureNotExtractable(matchedKey)
    try require(try publicBytes(copyPublic(key)) == publicBytes(copyPublic(matchedKey)), "Installed identity key mismatch")
    print("installed_public_leaf_only=true")
    printMetadata(certificate)
    print("next=Administrator checks the first Google Chrome private-key permission prompt; no ACL was modified")
}
func status() throws {
    guard let key = try findPrivateKey() else { print("trial_key_present=false"); return }
    try ensureNotExtractable(key)
    print("trial_key_present=true\nprivate_key_extractable=false\nprivate_key_protection=macOS_login_Keychain_software")
    print("certificate_cn=\(deviceCN)\noriginal_trial_deadline=\(originalTrialDeadline)")
}

func runOpenSSL(_ arguments: [String], input: Data) throws -> (Int32, String) {
    let process = Process(), inputPipe = Pipe(), outputPipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/openssl")
    process.arguments = arguments
    process.standardInput = inputPipe; process.standardOutput = outputPipe; process.standardError = outputPipe
    try process.run()
    inputPipe.fileHandleForWriting.write(input); try inputPipe.fileHandleForWriting.close()
    let result = outputPipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, String(data: result, encoding: .utf8) ?? "")
}
func selfTest() throws {
    // No Keychain lookup, no persistent item, no private-key file, no network.
    let key = try generateKey(persistent: false)
    let csr = try makeCSR(key)
    let parts = try TLV.one(csr).children()
    try require(parts.count == 3 && parts[2].tag == 0x03 && parts[2].value.first == 0, "CSR structure failed")
    var error: Unmanaged<CFError>?
    let verified = SecKeyVerifySignature(try copyPublic(key), .rsaSignatureMessagePKCS1v15SHA256,
                                        Data(parts[0].encoded) as CFData, Data(parts[2].value.dropFirst()) as CFData, &error)
    try require(verified, "Security framework CSR signature check failed")
    let external = try runOpenSSL(["req", "-verify", "-noout"], input: pem(csr, "CERTIFICATE REQUEST"))
    try require(external.0 == 0 && external.1.lowercased().contains("verify"), "OpenSSL CSR verification failed")
    let text = try runOpenSSL(["req", "-text", "-noout"], input: pem(csr, "CERTIFICATE REQUEST"))
    try require(text.0 == 0 && text.1.contains(deviceCN) && text.1.contains("2048") && text.1.contains("CA:FALSE") && text.1.contains("TLS Web Client Authentication"), "CSR purpose metadata check failed")
    var corrupted = csr; corrupted[corrupted.count - 1] ^= 1
    let invalid = try runOpenSSL(["req", "-verify", "-noout"], input: pem(corrupted, "CERTIFICATE REQUEST"))
    try require(invalid.0 != 0 || invalid.1.lowercased().contains("failure"), "Corrupted CSR was accepted")
    // Test leaf validation with an ephemeral self-signed public certificate. It is never installed/trusted.
    func makePublicTestCertificate(cn: String = deviceCN, ca: Bool = false, eku: Bool = true,
                                   keyUsage: [UInt8]? = [7,0x80]) throws -> [UInt8] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMddHHmmss'Z'"
        let now = Date()
        let validity = DER.seq([DER.wrap(0x18, Array(formatter.string(from: now.addingTimeInterval(-60)).utf8)),
                                DER.wrap(0x18, Array(formatter.string(from: now.addingTimeInterval(3600)).utf8))])
        let tbs = DER.seq([DER.wrap(0xa0, [0x02,0x01,0x02]), [0x02,0x01,0x01], DER.signatureAlgorithm,
                           DER.name("Ephemeral selftest CA"), validity, DER.name(cn), try spki(key),
                           DER.wrap(0xa3, DER.extensions(ca: ca, includeClientAuth: eku, keyUsage: keyUsage))])
        return DER.seq([tbs, DER.signatureAlgorithm, DER.bits(try sign(tbs, key))])
    }
    _ = try validateCertificate(makePublicTestCertificate(), key)
    _ = try validateCertificate(makePublicTestCertificate(keyUsage: nil), key)
    for bad in [try makePublicTestCertificate(cn: "Wrong-CN"), try makePublicTestCertificate(ca: true),
                try makePublicTestCertificate(eku: false),
                try makePublicTestCertificate(keyUsage: [5,0x20]), // keyEncipherment only, no digitalSignature
                try makePublicTestCertificate(keyUsage: [2,0x84]), // digitalSignature + keyCertSign
                try makePublicTestCertificate(keyUsage: [1,0x82])] { // digitalSignature + cRLSign
        do { _ = try validateCertificate(bad, key); throw Failure("Invalid test certificate was accepted") }
        catch let failure as Failure where failure.description == "Invalid test certificate was accepted" { throw failure }
        catch { /* expected refusal */ }
    }
    print("selftest=PASS")
    print("checks=nonpersistent_RSA2048,Security_CSR_signature,OpenSSL_CSR_verify,CSR_CN_KU_EKU_CAfalse,corrupt_CSR_rejected,valid_leaf,absent_KU_accepted,wrong_CN_rejected,CAtrue_rejected,missing_clientAuth_rejected,KU_without_digitalSignature_rejected,keyCertSign_rejected,cRLSign_rejected")
    print("persistent_nonextractable_key_generation=NOT_TESTED")
    print("persistent_keychain_changes=0\nprivate_key_exports=0\nnetwork_calls=0")
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    if args == ["--selftest"] { try selfTest() }
    else if args == ["--status"] { try status() }
    else if args.count == 2 && args[0] == "--prepare" { try prepare(args[1]) }
    else if args.count == 2 && args[0] == "--install" { try install(args[1]) }
    else {
        print("Usage: mac-identity --selftest | --status | --prepare PUBLIC_CSR_PATH | --install PUBLIC_CERT_PATH")
        print("--prepare creates one non-extractable software Keychain key; --install adds its public leaf certificate.")
        print("Run persistent commands only after explicit authorization for this Mac and Cloudflare trial identity.")
        exit(args.isEmpty ? 0 : 2)
    }
} catch {
    // Deliberately do not print Security attribute dictionaries, CFErrors, or certificate contents.
    fputs("mac-identity: \(error)\n", stderr)
    exit(1)
}

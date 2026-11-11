"""daemon 的密钥对：连接认证的签名和访问码的解密共用一对 RSA-3072。

私钥只存在本机，文件权限 0600，不进 SQLite，不进日志。
（Windows 上应当再用系统的数据保护接口加密一层，这一步还没做。）
"""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

AUTH_CONTEXT = "platerelay-daemon-auth/v1"


class DaemonKeys:
    def __init__(self, private_key: rsa.RSAPrivateKey) -> None:
        self._key = private_key

    @classmethod
    def load_or_create(cls, path: Path) -> DaemonKeys:
        if path.exists():
            return cls(serialization.load_pem_private_key(path.read_bytes(), password=None))  # type: ignore[arg-type]
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(pem)
        return cls(key)

    def _public_der(self) -> bytes:
        return self._key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    def public_key_base64(self) -> str:
        return base64.b64encode(self._public_der()).decode()

    def fingerprint(self) -> str:
        return hashlib.sha256(self._public_der()).hexdigest()

    def sign_challenge(self, daemon_id: str, nonce: str, origin: str) -> str:
        """签名里带上面板的 origin，这样签名不能拿到别的面板去用。"""
        message = f"{AUTH_CONTEXT}\n{daemon_id}\n{nonce}\n{origin}".encode()
        signature = self._key.sign(message, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
        return base64.b64encode(signature).decode()

    def decrypt(self, cipher_base64: str) -> str:
        """解开浏览器用公钥加密的访问码。结果只留在内存里。"""
        plain = self._key.decrypt(
            base64.b64decode(cipher_base64),
            padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
        )
        return plain.decode()

// FluxCloud 账户/设备相关数据模型 —— 字段严格对照契约 v1（服务端 camelCase 直传JSON，
// 本文件只做「JSON → 强类型 Dart 对象」的薄封装，不含任何业务逻辑）。
//
// Entitlements 按契约建议保留原始 json（套餐能力字段由服务端自由演进，客户端
// 只对已知字段提供便捷读取，避免每加一个套餐字段就要跟着改模型）。

/// 用户状态，对应服务端 UserDto.status（"active"|"disabled"|"pending"）。
/// pending = 已注册但邮箱验证码尚未验证（两阶段注册的中间态）。
enum CloudUserStatus {
  active,
  disabled,
  pending;

  static CloudUserStatus fromWire(String? value) => switch (value) {
    'disabled' => CloudUserStatus.disabled,
    'pending' => CloudUserStatus.pending,
    _ => CloudUserStatus.active,
  };

  String get wireValue => switch (this) {
    CloudUserStatus.active => 'active',
    CloudUserStatus.disabled => 'disabled',
    CloudUserStatus.pending => 'pending',
  };
}

/// 云账户用户信息（对应服务端 UserDto）。
class CloudUser {
  final String id;
  final String email;
  final String nickname;
  final String plan;
  final CloudUserStatus status;
  final String createdAt;
  final String? lastLoginAt;

  const CloudUser({
    required this.id,
    required this.email,
    required this.nickname,
    required this.plan,
    required this.status,
    required this.createdAt,
    this.lastLoginAt,
  });

  factory CloudUser.fromJson(Map<String, dynamic> json) => CloudUser(
    id: json['id'] as String,
    email: json['email'] as String,
    nickname: (json['nickname'] as String?) ?? '',
    plan: (json['plan'] as String?) ?? '',
    status: CloudUserStatus.fromWire(json['status'] as String?),
    createdAt: (json['createdAt'] as String?) ?? '',
    lastLoginAt: json['lastLoginAt'] as String?,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'nickname': nickname,
    'plan': plan,
    'status': status.wireValue,
    'createdAt': createdAt,
    'lastLoginAt': lastLoginAt,
  };
}

/// 套餐能力集：保留服务端原始 json（见 server/crates/server/src/entitlement.rs 的
/// 前向兼容设计），仅对当前已知字段提供便捷读取，未知字段不丢失、不报错。
class Entitlements {
  final Map<String, dynamic> raw;

  const Entitlements(this.raw);

  factory Entitlements.fromJson(Map<String, dynamic>? json) =>
      Entitlements(json ?? const {});

  /// 同时保有登录会话/同步的设备数上限（同服务端 entitlement.rs 语义）。
  int get maxSyncDevices => (raw['maxSyncDevices'] as num?)?.toInt() ?? 0;

  Map<String, dynamic> toJson() => raw;
}

/// GET /me 响应：用户信息 + 套餐能力快照。
class CloudProfile {
  final CloudUser user;
  final Entitlements entitlements;

  const CloudProfile({required this.user, required this.entitlements});

  factory CloudProfile.fromJson(Map<String, dynamic> json) => CloudProfile(
    user: CloudUser.fromJson(json),
    entitlements: Entitlements.fromJson(
      json['entitlements'] as Map<String, dynamic>?,
    ),
  );
}

/// 受信任设备（对应服务端 DeviceDto）。
class CloudDevice {
  /// 服务端 devices 表行 id（PATCH/DELETE /devices/{id} 用这个）。
  final String id;

  /// 客户端持久设备标识（同 [DeviceIdentity.deviceId]，用于判断"是否当前设备"）。
  final String deviceId;
  final String name;
  final String? platform;
  final String createdAt;
  final String lastSeenAt;

  /// 最近登录 IP（服务端按 X-Forwarded-For 首项 → X-Real-IP → 对端地址记录，
  /// v1.1 新增，可空——旧设备行/未记录到时为 null）。
  final String? lastIp;

  /// 该设备最近一次发令牌请求携带的客户端版本号（v1.1 新增，可空）。
  final String? appVersion;

  const CloudDevice({
    required this.id,
    required this.deviceId,
    required this.name,
    this.platform,
    required this.createdAt,
    required this.lastSeenAt,
    this.lastIp,
    this.appVersion,
  });

  factory CloudDevice.fromJson(Map<String, dynamic> json) => CloudDevice(
    id: json['id'] as String,
    deviceId: json['deviceId'] as String,
    name: (json['name'] as String?) ?? '',
    platform: json['platform'] as String?,
    createdAt: (json['createdAt'] as String?) ?? '',
    lastSeenAt: (json['lastSeenAt'] as String?) ?? '',
    lastIp: json['lastIp'] as String?,
    appVersion: json['appVersion'] as String?,
  );
}

/// 登录/注册验证/验证码登录 成功后的统一响应（AuthResponse）。
class AuthResponse {
  final String accessToken;
  final String refreshToken;
  final int expiresIn;
  final CloudUser user;
  final Entitlements entitlements;
  final CloudDevice device;

  const AuthResponse({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.user,
    required this.entitlements,
    required this.device,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) => AuthResponse(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    expiresIn: (json['expiresIn'] as num?)?.toInt() ?? 0,
    user: CloudUser.fromJson(json['user'] as Map<String, dynamic>),
    entitlements: Entitlements.fromJson(
      json['entitlements'] as Map<String, dynamic>?,
    ),
    device: CloudDevice.fromJson(json['device'] as Map<String, dynamic>),
  );
}

/// POST /auth/login 的 tagged 响应：设备已受信任则直接下发令牌（[LoginOk]），
/// 新设备则要求邮箱验证码（[LoginDeviceVerificationRequired]）。
sealed class LoginResult {
  const LoginResult();
}

class LoginOk extends LoginResult {
  final AuthResponse auth;
  const LoginOk(this.auth);
}

class LoginDeviceVerificationRequired extends LoginResult {
  final int ttlSeconds;
  const LoginDeviceVerificationRequired(this.ttlSeconds);
}

/// 服务端错误统一形态 `{code, message}`（见 error.rs），附带 HTTP 状态码方便
/// 调用方按状态/code 分支处理（如 409 registration_incomplete）。
class CloudApiException implements Exception {
  final String code;
  final String message;
  final int status;

  const CloudApiException({
    required this.code,
    required this.message,
    required this.status,
  });

  @override
  String toString() => 'CloudApiException($status $code: $message)';
}

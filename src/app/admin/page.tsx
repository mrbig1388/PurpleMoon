/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Settings,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import {
  AdminConfig,
  AdminConfigResult,
  InviteCodeItem,
} from '@/lib/admin.types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { DEFAULT_INVITE_MAX_USES, isInviteCodeExpired } from '@/lib/invite';
import {
  adminMayTakeOverAccount,
  LEGACY_GROUP_A,
  LEGACY_GROUP_B,
  resolveGroups,
} from '@/lib/user-groups';

import PageLayout from '@/components/PageLayout';

// 统一弹窗方法（必须在首次使用前定义）
const showError = (message: string) =>
  Swal.fire({ icon: 'error', title: '错误', text: message });

const showSuccess = (message: string) =>
  Swal.fire({
    icon: 'success',
    title: '成功',
    text: message,
    timer: 2000,
    showConfirmButton: false,
  });

// 新增站点配置类型
interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  ImageProxy: string;
}

// 视频源数据类型
interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 可折叠标签组件
interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleTab = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <div className='rounded-xl shadow-sm mb-4 overflow-hidden bg-white/80 backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700'>
      <button
        onClick={onToggle}
        className='w-full px-6 py-4 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-700/60 transition-colors'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
        </div>
        <div className='text-gray-500 dark:text-gray-400'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && <div className='px-6 py-4'>{children}</div>}
    </div>
  );
};

// 邀请码接口请求辅助函数
const callInviteApi = async (payload: Record<string, unknown>) => {
  const res = await fetch('/api/admin/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `操作失败: ${res.status}`);
  }
};

// 生成 8 位随机邀请码（不含易混淆字符）
function generateRandomInviteCode(length = 8): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const EXPIRY_PRESET_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function resolveInviteExpiryInput(
  preset: string,
  customDateTime: string
): { ok: true; expiresAt: number | null } | { ok: false; error: string } {
  if (!preset || preset === 'never') {
    return { ok: true, expiresAt: null };
  }
  if (EXPIRY_PRESET_MS[preset]) {
    return { ok: true, expiresAt: Date.now() + EXPIRY_PRESET_MS[preset] };
  }
  if (preset === 'custom') {
    if (!customDateTime.trim()) {
      return { ok: false, error: '请选择具体的自定义过期时间' };
    }
    const ts = new Date(customDateTime).getTime();
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      return { ok: false, error: '自定义过期时间必须晚于当前时间' };
    }
    return { ok: true, expiresAt: Math.floor(ts) };
  }
  return { ok: false, error: '无效的有效期选项' };
}

function formatDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatInviteExpiryDisplay(expiresAt?: number | null): {
  label: string;
  hint?: string;
  expired: boolean;
} {
  if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return { label: '永不过期', expired: false };
  }
  const now = Date.now();
  const label = formatDateTimeLocal(expiresAt);
  if (now >= expiresAt) {
    return { label, hint: '已过期', expired: true };
  }
  const diffMs = expiresAt - now;
  const mins = Math.ceil(diffMs / 60000);
  if (mins < 60) {
    return { label, hint: `剩 ${mins} 分钟`, expired: false };
  }
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 24) {
    return { label, hint: `剩 ${hours} 小时`, expired: false };
  }
  const days = Math.ceil(diffMs / (24 * 3600000));
  return { label, hint: `剩 ${days} 天`, expired: false };
}

// 用户配置组件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const [userSettings, setUserSettings] = useState({
    enableRegistration: false,
    requireInviteCode: false,
  });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [showAddInviteForm, setShowAddInviteForm] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [newInvite, setNewInvite] = useState({
    code: '',
    groupId: LEGACY_GROUP_B,
    maxUses: DEFAULT_INVITE_MAX_USES,
    expiryPreset: 'never',
    customExpiry: '',
    note: '',
  });

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  useEffect(() => {
    if (config?.UserConfig) {
      const runtimeRequireInvite =
        typeof window !== 'undefined'
          ? Boolean((window as any).RUNTIME_CONFIG?.REQUIRE_INVITE_CODE)
          : false;
      const rawRequireInvite = config.InviteConfig?.RequireInviteCode;
      const effectiveRequireInvite =
        typeof rawRequireInvite === 'boolean'
          ? rawRequireInvite
          : runtimeRequireInvite;

      setUserSettings({
        enableRegistration: config.UserConfig.AllowRegister,
        requireInviteCode: effectiveRequireInvite,
      });

      const rg = resolveGroups(config);
      if (rg.configured && rg.groups.length > 0) {
        setNewInvite((prev) =>
          rg.groups.some((g) => g.id === prev.groupId)
            ? prev
            : { ...prev, groupId: rg.defaultId }
        );
      }
    }
  }, [config]);

  // 切换允许注册设置
  const toggleAllowRegister = async (value: boolean) => {
    try {
      // 先更新本地 UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: value }));

      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAllowRegister',
          allowRegister: value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      if (typeof window !== 'undefined' && (window as any).RUNTIME_CONFIG) {
        (window as any).RUNTIME_CONFIG.ENABLE_REGISTER = value;
      }
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      // revert toggle UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: !value }));
    }
  };

  // 切换是否强制要求邀请码注册（仅站长）
  const toggleRequireInviteCode = async (value: boolean) => {
    if (role !== 'owner') return;
    try {
      setUserSettings((prev) => ({ ...prev, requireInviteCode: value }));
      await callInviteApi({
        action: 'setRequireInviteCode',
        requireInviteCode: value,
      });
      if (typeof window !== 'undefined' && (window as any).RUNTIME_CONFIG) {
        (window as any).RUNTIME_CONFIG.REQUIRE_INVITE_CODE = value;
      }
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      setUserSettings((prev) => ({ ...prev, requireInviteCode: !value }));
    }
  };

  // 新增邀请码（仅站长）
  const handleCreateInviteCode = async () => {
    const code = newInvite.code.trim();
    if (!code) return;
    const expiryRes = resolveInviteExpiryInput(
      newInvite.expiryPreset,
      newInvite.customExpiry
    );
    if (!expiryRes.ok) {
      showError(expiryRes.error);
      return;
    }

    setInviteBusy(true);
    try {
      await callInviteApi({
        action: 'createCode',
        code,
        groupId: newInvite.groupId,
        maxUses: Number(newInvite.maxUses) || DEFAULT_INVITE_MAX_USES,
        expiresAt: expiryRes.expiresAt,
        note: newInvite.note.trim(),
      });
      showSuccess(`邀请码 ${code} 已创建`);
      setNewInvite((prev) => ({
        ...prev,
        code: '',
        maxUses: DEFAULT_INVITE_MAX_USES,
        expiryPreset: 'never',
        customExpiry: '',
        note: '',
      }));
      setShowAddInviteForm(false);
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '创建邀请码失败');
    } finally {
      setInviteBusy(false);
    }
  };

  // 修改邀请码绑定分组
  const handleUpdateInviteGroup = async (code: string, groupId: string) => {
    setInviteBusy(true);
    try {
      await callInviteApi({
        action: 'updateCode',
        code,
        groupId,
      });
      showSuccess('已更新邀请码分组');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '更新失败');
      await refreshConfig();
    } finally {
      setInviteBusy(false);
    }
  };

  // 修改邀请码最大可用次数
  const handleEditInviteMaxUses = async (item: InviteCodeItem) => {
    const { isConfirmed, value } = await Swal.fire({
      title: `设置邀请码「${item.code}」最大可用次数`,
      input: 'number',
      inputValue: String(item.maxUses ?? DEFAULT_INVITE_MAX_USES),
      inputAttributes: {
        min: '1',
        max: '100000',
        step: '1',
      },
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValidator: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 100000) {
          return '请输入 1 ~ 100000 之间的整数';
        }
        return undefined;
      },
    });
    if (!isConfirmed) return;
    setInviteBusy(true);
    try {
      await callInviteApi({
        action: 'updateCode',
        code: item.code,
        maxUses: Number(value),
      });
      showSuccess('可用次数已更新');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setInviteBusy(false);
    }
  };

  // 修改邀请码过期时间
  const handleEditInviteExpiry = async (item: InviteCodeItem) => {
    const { isConfirmed, value } = await Swal.fire({
      title: `设置邀请码「${item.code}」有效期`,
      input: 'select',
      inputOptions: {
        never: '永不过期',
        '1h': '从现在起 1 小时后过期',
        '24h': '从现在起 24 小时（1 天）后过期',
        '7d': '从现在起 7 天后过期',
        '30d': '从现在起 30 天后过期',
        '90d': '从现在起 90 天后过期',
        custom: '自定义日期时间…',
      },
      inputValue: item.expiresAt ? '7d' : 'never',
      showCancelButton: true,
      confirmButtonText: '下一步 / 保存',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    let targetExpiresAt: number | null = null;
    if (value === 'custom') {
      const defaultStr = formatDateTimeLocal(
        item.expiresAt && item.expiresAt > Date.now()
          ? item.expiresAt
          : Date.now() + 7 * 24 * 3600 * 1000
      ).replace(' ', 'T');
      const customModal = await Swal.fire({
        title: `输入「${item.code}」到期时间`,
        html: `<input id="swal-invite-expiry" type="datetime-local" class="swal2-input" value="${defaultStr}">`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        preConfirm: () => {
          const el = document.getElementById(
            'swal-invite-expiry'
          ) as HTMLInputElement | null;
          const raw = el?.value || '';
          const r = resolveInviteExpiryInput('custom', raw);
          if (!r.ok) {
            Swal.showValidationMessage(r.error);
            return null;
          }
          return r.expiresAt;
        },
      });
      if (!customModal.isConfirmed) return;
      targetExpiresAt = customModal.value as number;
    } else {
      const r = resolveInviteExpiryInput(String(value), '');
      if (!r.ok) {
        showError(r.error);
        return;
      }
      targetExpiresAt = r.expiresAt;
    }

    setInviteBusy(true);
    try {
      await callInviteApi({
        action: 'updateCode',
        code: item.code,
        expiresAt: targetExpiresAt,
      });
      showSuccess(
        targetExpiresAt ? '邀请码过期时间已更新' : '已设为永不过期'
      );
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setInviteBusy(false);
    }
  };

  // 重置邀请码已用次数
  const handleResetInviteUsedCount = async (code: string) => {
    setInviteBusy(true);
    try {
      await callInviteApi({
        action: 'updateCode',
        code,
        resetUsedCount: true,
      });
      showSuccess(`邀请码「${code}」已用次数已清零`);
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setInviteBusy(false);
    }
  };

  // 删除邀请码
  const handleDeleteInviteCode = async (code: string) => {
    const { isConfirmed } = await Swal.fire({
      title: `确认删除邀请码「${code}」？`,
      text: '删除后该邀请码将立即失效（已注册用户的分组不受影响）',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });
    if (!isConfirmed) return;
    setInviteBusy(true);
    try {
      await callInviteApi({
        action: 'deleteCode',
        code,
      });
      showSuccess('邀请码已删除');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleBanUser = async (uname: string) => {
    await handleUserAction('ban', uname);
  };

  const handleUnbanUser = async (uname: string) => {
    await handleUserAction('unban', uname);
  };

  const handleSetAdmin = async (uname: string) => {
    await handleUserAction('setAdmin', uname);
  };

  const handleRemoveAdmin = async (uname: string) => {
    await handleUserAction('cancelAdmin', uname);
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await handleUserAction('add', newUser.username, newUser.password);
    setNewUser({ username: '', password: '' });
    setShowAddUserForm(false);
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await handleUserAction(
      'changePassword',
      changePasswordUser.username,
      changePasswordUser.password
    );
    setChangePasswordUser({ username: '', password: '' });
    setShowChangePasswordForm(false);
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = async (username: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '确认删除用户',
      text: `删除用户 ${username} 将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    await handleUserAction('deleteUser', username);
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string
  ) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      // 成功后刷新配置（无需整页刷新）
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleSetUserGroup = async (targetUsername: string, groupId: string) => {
    try {
      const res = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setUserGroup', targetUsername, groupId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      await refreshConfig();
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  const rg = resolveGroups(config);
  const availableInviteGroups = rg.configured
    ? rg.groups
    : [
        { id: LEGACY_GROUP_A, name: 'A 组（全部资源站）', allSources: true, sourceKeys: [] },
        { id: LEGACY_GROUP_B, name: 'B 组（默认注册分组）', allSources: false, sourceKeys: [] },
      ];
  const rawInviteCodes = config.InviteConfig?.Codes;
  const inviteCodes: InviteCodeItem[] = Array.isArray(rawInviteCodes)
    ? rawInviteCodes
    : [];

  return (
    <div className='space-y-6'>
      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            总用户数
          </div>
        </div>
      </div>

      {/* 注册设置 */}
      <div className='space-y-4'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          注册设置
        </h4>
        <div className='flex items-center justify-between'>
          <div>
            <div className='text-gray-700 dark:text-gray-300'>
              允许新用户注册
            </div>
          </div>
          <button
            type='button'
            onClick={() => toggleAllowRegister(!userSettings.enableRegistration)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              userSettings.enableRegistration
                ? 'bg-green-600'
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                userSettings.enableRegistration
                  ? 'translate-x-6'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 邀请码注册开关（仅站长可控制） */}
        {role === 'owner' && (
          <div className='flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700/60'>
            <div>
              <div className='text-gray-700 dark:text-gray-300'>
                开启邀请码注册
              </div>
            </div>
            <button
              type='button'
              onClick={() =>
                toggleRequireInviteCode(!userSettings.requireInviteCode)
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                userSettings.requireInviteCode
                  ? 'bg-green-600'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  userSettings.requireInviteCode
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* 邀请码管理（仅站长可见与操作） */}
      {role === 'owner' && (
        <div className='p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/40 space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                邀请码管理
                <span className='px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'>
                  共 {inviteCodes.length} 个
                </span>
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                默认可使用 {DEFAULT_INVITE_MAX_USES} 次
              </p>
            </div>
            <button
              type='button'
              onClick={() => setShowAddInviteForm(!showAddInviteForm)}
              className='px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
            >
              {showAddInviteForm ? '取消' : '新增邀请码'}
            </button>
          </div>

          {showAddInviteForm && (
            <div className='p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3'>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3'>
                <div>
                  <label className='block text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    邀请码（支持字母/数字/下划线/连字符）
                  </label>
                  <div className='flex gap-1.5'>
                    <input
                      type='text'
                      placeholder='输入新的邀请码'
                      maxLength={64}
                      value={newInvite.code}
                      onChange={(e) =>
                        setNewInvite((prev) => ({
                          ...prev,
                          code: e.target.value,
                        }))
                      }
                      className='flex-1 min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100'
                    />
                    <button
                      type='button'
                      onClick={() =>
                        setNewInvite((prev) => ({
                          ...prev,
                          code: generateRandomInviteCode(8),
                        }))
                      }
                      className='px-2.5 py-2 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg whitespace-nowrap'
                    >
                      随机生成
                    </button>
                  </div>
                </div>

                <div>
                  <label className='block text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    注册后自动归入分组
                  </label>
                  <select
                    value={newInvite.groupId}
                    onChange={(e) =>
                      setNewInvite((prev) => ({
                        ...prev,
                        groupId: e.target.value,
                      }))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100'
                  >
                    {availableInviteGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className='block text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    最大可使用次数（默认 {DEFAULT_INVITE_MAX_USES} 次）
                  </label>
                  <input
                    type='number'
                    min={1}
                    max={100000}
                    value={newInvite.maxUses}
                    onChange={(e) =>
                      setNewInvite((prev) => ({
                        ...prev,
                        maxUses: Number(e.target.value),
                      }))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100'
                  />
                </div>

                <div>
                  <label className='block text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    过期时间设置
                  </label>
                  <div className='space-y-1.5'>
                    <select
                      value={newInvite.expiryPreset}
                      onChange={(e) =>
                        setNewInvite((prev) => ({
                          ...prev,
                          expiryPreset: e.target.value,
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100'
                    >
                      <option value='never'>永不过期</option>
                      <option value='1h'>1 小时后过期</option>
                      <option value='24h'>24 小时（1 天）后过期</option>
                      <option value='7d'>7 天后过期</option>
                      <option value='30d'>30 天后过期</option>
                      <option value='90d'>90 天后过期</option>
                      <option value='custom'>自定义到期时间…</option>
                    </select>
                    {newInvite.expiryPreset === 'custom' && (
                      <input
                        type='datetime-local'
                        value={newInvite.customExpiry}
                        onChange={(e) =>
                          setNewInvite((prev) => ({
                            ...prev,
                            customExpiry: e.target.value,
                          }))
                        }
                        className='w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100'
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label className='block text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    备注（选填）
                  </label>
                  <input
                    type='text'
                    placeholder='如：A组亲友码'
                    maxLength={50}
                    value={newInvite.note}
                    onChange={(e) =>
                      setNewInvite((prev) => ({
                        ...prev,
                        note: e.target.value,
                      }))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100'
                  />
                </div>
              </div>

              <div className='flex justify-end'>
                <button
                  type='button'
                  onClick={handleCreateInviteCode}
                  disabled={inviteBusy || !newInvite.code.trim()}
                  className='px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white text-sm rounded-lg transition-colors'
                >
                  创建邀请码
                </button>
              </div>
            </div>
          )}

          {inviteCodes.length === 0 ? (
            <div className='text-xs text-gray-500 dark:text-gray-400 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg'>
              暂未在后台创建邀请码。点击右上角「新增邀请码」即可添加并设置分组、可用次数和过期时间。
            </div>
          ) : (
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto bg-white dark:bg-gray-800'>
              <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
                <thead className='bg-gray-50 dark:bg-gray-900'>
                  <tr>
                    <th className='px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      邀请码
                    </th>
                    <th className='px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      分配分组
                    </th>
                    <th className='px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      已用 / 可用次数
                    </th>
                    <th className='px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      过期时间
                    </th>
                    <th className='px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      状态
                    </th>
                    <th className='px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      备注
                    </th>
                    <th className='px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {inviteCodes.map((item) => {
                    const expired = isInviteCodeExpired(item);
                    const exhausted =
                      (item.usedCount ?? 0) >=
                      (item.maxUses ?? DEFAULT_INVITE_MAX_USES);
                    const expiryInfo = formatInviteExpiryDisplay(
                      item.expiresAt
                    );
                    return (
                      <tr
                        key={item.code}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors'
                      >
                        <td className='px-4 py-3 whitespace-nowrap text-sm font-mono font-semibold text-gray-900 dark:text-gray-100'>
                          {item.code}
                        </td>
                        <td className='px-4 py-3 whitespace-nowrap text-sm'>
                          <select
                            disabled={inviteBusy}
                            value={
                              availableInviteGroups.some(
                                (g) => g.id === item.groupId
                              )
                                ? item.groupId
                                : availableInviteGroups[0]?.id ?? ''
                            }
                            onChange={(e) =>
                              e.target.value &&
                              handleUpdateInviteGroup(item.code, e.target.value)
                            }
                            className='px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100'
                          >
                            {availableInviteGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className='px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300'>
                          <span className='font-semibold'>{item.usedCount ?? 0}</span>
                          {' / '}
                          <span>{item.maxUses ?? DEFAULT_INVITE_MAX_USES}</span>
                          <span className='ml-1.5 text-xs text-gray-400'>
                            (剩余{' '}
                            {Math.max(
                              0,
                              (item.maxUses ?? DEFAULT_INVITE_MAX_USES) -
                                (item.usedCount ?? 0)
                            )}{' '}
                            次)
                          </span>
                        </td>
                        <td className='px-4 py-3 whitespace-nowrap text-xs text-gray-700 dark:text-gray-300'>
                          <div>{expiryInfo.label}</div>
                          {expiryInfo.hint && (
                            <div
                              className={`text-[11px] ${
                                expiryInfo.expired
                                  ? 'text-red-600 dark:text-red-400 font-medium'
                                  : 'text-gray-400 dark:text-gray-500'
                              }`}
                            >
                              {expiryInfo.hint}
                            </div>
                          )}
                        </td>
                        <td className='px-4 py-3 whitespace-nowrap'>
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full ${
                              !expired && !exhausted
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {expired
                              ? '已过期'
                              : exhausted
                              ? '已用尽'
                              : '可用'}
                          </span>
                        </td>
                        <td className='px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 max-w-[10rem] truncate'>
                          {item.note || '-'}
                        </td>
                        <td className='px-4 py-3 whitespace-nowrap text-right text-xs font-medium space-x-1.5'>
                          <button
                            type='button'
                            onClick={() => {
                              if (navigator?.clipboard) {
                                navigator.clipboard
                                  .writeText(item.code)
                                  .then(() =>
                                    showSuccess(`已复制邀请码：${item.code}`)
                                  )
                                  .catch(() => undefined);
                              }
                            }}
                            className='inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors'
                          >
                            复制
                          </button>
                          <button
                            type='button'
                            disabled={inviteBusy}
                            onClick={() => handleEditInviteMaxUses(item)}
                            className='inline-flex items-center px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60 transition-colors'
                          >
                            设次数
                          </button>
                          <button
                            type='button'
                            disabled={inviteBusy}
                            onClick={() => handleEditInviteExpiry(item)}
                            className='inline-flex items-center px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-200 dark:hover:bg-purple-900/60 transition-colors'
                          >
                            设有效期
                          </button>
                          {(item.usedCount ?? 0) > 0 && (
                            <button
                              type='button'
                              disabled={inviteBusy}
                              onClick={() =>
                                handleResetInviteUsedCount(item.code)
                              }
                              className='inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60 transition-colors'
                            >
                              清零已用
                            </button>
                          )}
                          <button
                            type='button'
                            disabled={inviteBusy}
                            onClick={() => handleDeleteInviteCode(item.code)}
                            className='inline-flex items-center px-2.5 py-1 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors'
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <button
            onClick={() => {
              setShowAddUserForm(!showAddUserForm);
              if (showChangePasswordForm) {
                setShowChangePasswordForm(false);
                setChangePasswordUser({ username: '', password: '' });
              }
            }}
            className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
          >
            {showAddUserForm ? '取消' : '添加用户'}
          </button>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={newUser.username}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, username: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <input
                type='password'
                placeholder='密码'
                value={newUser.password}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, password: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <button
                onClick={handleAddUser}
                disabled={!newUser.username || !newUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                添加
              </button>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={!changePasswordUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                修改密码
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className='w-full sm:w-auto px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors'
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  分组
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {sortedUsers.map((user) => {
                    // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户和自己的密码，但任何人都不能修改站长密码
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站长密码
                      (role === 'owner' || // 站长可以修改管理员和普通用户密码
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername) &&
                          // 管理员不能改资源站权限高于自己的用户的密码（防越权）
                          adminMayTakeOverAccount(
                            config,
                            currentUsername || '',
                            user.username,
                            ''
                          ))); // 管理员可以修改普通用户和自己的密码

                    // 删除用户权限：站长可删除除自己外的所有用户，管理员仅可删除普通用户
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站长可以删除除自己外的所有用户
                        (role === 'admin' && user.role === 'user')); // 管理员仅可删除普通用户

                    // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && user.role === 'user'));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                      >
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                : user.role === 'admin'
                                ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站长'
                              : user.role === 'admin'
                              ? '管理员'
                              : '普通用户'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          {(() => {
                            const badge = (text: string, cls: string) => (
                              <span className={`px-2 py-1 text-xs rounded-full ${cls}`}>
                                {text}
                              </span>
                            );
                            if (user.role === 'owner')
                              return badge('不受限', 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300');
                            if (!rg.configured)
                              return badge('未启用', 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400');
                            const cur = rg.groups.find((g) => g.id === user.group);
                            if (role !== 'owner')
                              return badge(
                                cur ? cur.name : '默认分组',
                                'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                              );
                            return (
                              <select
                                value={cur ? cur.id : ''}
                                onChange={(e) =>
                                  e.target.value && handleSetUserGroup(user.username, e.target.value)
                                }
                                className='px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 max-w-[10rem]'
                              >
                                {!cur && <option value=''>（未分组，按默认）</option>}
                                {rg.groups.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密码按钮 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-200 transition-colors'
                            >
                              修改密码
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按钮 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900/40 dark:hover:bg-purple-900/60 dark:text-purple-200 transition-colors'
                                >
                                  设为管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 transition-colors'
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-300 transition-colors'
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors'
                            >
                              删除用户
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>
    </div>
  );
};

// 用户分组与资源站权限配置（仅站长）
const callGroupApi = async (payload: Record<string, unknown>) => {
  const res = await fetch('/api/admin/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `操作失败: ${res.status}`);
  }
};

interface GroupEditorProps {
  group: { id: string; name: string; allSources: boolean; sourceKeys: string[] };
  isDefault: boolean;
  memberCount: number;
  enabledSources: AdminConfig['SourceConfig'];
  otherGroups: { id: string; name: string }[];
  onChanged: () => Promise<void>;
}

const GroupEditor = ({
  group,
  isDefault,
  memberCount,
  enabledSources,
  otherGroups,
  onChanged,
}: GroupEditorProps) => {
  const [name, setName] = useState(group.name);
  const [allSources, setAllSources] = useState(group.allSources);
  const [selected, setSelected] = useState<string[]>(group.sourceKeys);
  const [busy, setBusy] = useState(false);

  // 服务端数据刷新后同步草稿
  useEffect(() => {
    setName(group.name);
    setAllSources(group.allSources);
    setSelected(group.sourceKeys);
    // 只在该分组的内容真正变化时同步，避免其它分组保存导致的刷新冲掉这里未保存的草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, group.name, group.allSources, group.sourceKeys.join('|')]);

  const enabledKeys = new Set(enabledSources.map((s) => s.key));
  const effectiveSelected = selected.filter((k) => enabledKeys.has(k));
  const dirty =
    name.trim() !== group.name ||
    allSources !== group.allSources ||
    (!allSources &&
      (effectiveSelected.length !== group.sourceKeys.filter((k) => enabledKeys.has(k)).length ||
        effectiveSelected.some((k) => !group.sourceKeys.includes(k))));

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) showSuccess(okMsg);
      await onChanged();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!allSources && effectiveSelected.length === 0) {
      const r = await Swal.fire({
        icon: 'warning',
        title: '该分组将无法访问任何资源站',
        text: '组内用户将搜索不到任何内容，确定保存吗？',
        showCancelButton: true,
        confirmButtonText: '确定保存',
        cancelButtonText: '取消',
      });
      if (!r.isConfirmed) return;
    }
    await run(
      () =>
        callGroupApi({
          action: 'updateGroup',
          id: group.id,
          name,
          allSources,
          // 已被禁用 / 已删除的源不再写入，保持列表干净
          sourceKeys: effectiveSelected,
        }),
      '分组已保存'
    );
  };

  const remove = async () => {
    let moveToGroupId: string | undefined;
    if (memberCount > 0 || isDefault) {
      const options: Record<string, string> = {};
      otherGroups.forEach((g) => (options[g.id] = g.name));
      const r = await Swal.fire({
        icon: 'warning',
        title: `删除分组「${group.name}」`,
        text: `该分组有 ${memberCount} 名用户${isDefault ? '，且是默认注册分组' : ''}，请选择他们迁移到哪个分组：`,
        input: 'select',
        inputOptions: options,
        inputPlaceholder: '选择迁移目标分组',
        showCancelButton: true,
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        inputValidator: (v) => (v ? undefined : '请选择迁移目标分组'),
      });
      if (!r.isConfirmed) return;
      moveToGroupId = r.value as string;
    } else {
      const r = await Swal.fire({
        icon: 'warning',
        title: `删除分组「${group.name}」？`,
        showCancelButton: true,
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      });
      if (!r.isConfirmed) return;
    }
    await run(
      () => callGroupApi({ action: 'deleteGroup', id: group.id, moveToGroupId }),
      '分组已删除'
    );
  };

  return (
    <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <input
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          className='px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-48'
          aria-label='分组名称'
        />
        <span className='text-xs text-gray-500 dark:text-gray-400'>{memberCount} 名用户</span>
        {isDefault ? (
          <span className='px-2 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'>
            默认注册分组
          </span>
        ) : (
          <button
            type='button'
            disabled={busy}
            onClick={() =>
              run(() => callGroupApi({ action: 'setDefaultGroup', id: group.id }), '已设为默认注册分组')
            }
            className='px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
          >
            设为默认注册分组
          </button>
        )}
        <div className='ml-auto space-x-2'>
          <button
            type='button'
            onClick={save}
            disabled={busy || !dirty || !name.trim()}
            className='px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg'
          >
            保存
          </button>
          <button
            type='button'
            onClick={remove}
            disabled={busy || otherGroups.length === 0}
            title={otherGroups.length === 0 ? '至少保留一个分组' : undefined}
            className='px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg'
          >
            删除
          </button>
        </div>
      </div>

      <label className='flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer'>
        <input
          type='checkbox'
          checked={allSources}
          onChange={(e) => setAllSources(e.target.checked)}
        />
        可访问全部已启用的资源站（包含以后新增的）
      </label>

      {!allSources && (
        <div>
          <div className='flex items-center justify-between mb-1'>
            <span className='text-sm text-gray-700 dark:text-gray-300'>
              可访问的资源站（已选 {effectiveSelected.length} / {enabledSources.length}）
            </span>
            <div className='space-x-2 text-xs'>
              <button
                type='button'
                onClick={() => setSelected(enabledSources.map((s) => s.key))}
                className='px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
              >
                全选
              </button>
              <button
                type='button'
                onClick={() => setSelected([])}
                className='px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
              >
                清空
              </button>
            </div>
          </div>
          <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 max-h-56 overflow-y-auto p-3 border border-gray-200 dark:border-gray-700 rounded-lg'>
            {enabledSources.map((s) => (
              <label
                key={s.key}
                className='flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer'
              >
                <input
                  type='checkbox'
                  checked={selected.includes(s.key)}
                  onChange={() =>
                    setSelected((prev) =>
                      prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key]
                    )
                  }
                />
                <span className='truncate'>{s.name}</span>
                {s.from === 'custom' && (
                  <span className='text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500'>
                    自定义
                  </span>
                )}
              </label>
            ))}
            {enabledSources.length === 0 && (
              <span className='text-sm text-gray-500'>暂无已启用的资源站</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const GroupPermissionConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!config) return null;
  const rg = resolveGroups(config);
  const enabledSources = (config.SourceConfig || []).filter((s) => !s.disabled);
  const countMembers = (id: string) =>
    config.UserConfig.Users.filter(
      (u) => u.role !== 'owner' && (u.group === id || (!rg.groups.some((g) => g.id === u.group) && rg.defaultId === id))
    ).length;

  const enable = async () => {
    setBusy(true);
    try {
      await callGroupApi({ action: 'enableGroups' });
      showSuccess('已启用分组功能');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await callGroupApi({
        action: 'createGroup',
        name: newName,
        allSources: false,
        sourceKeys: [],
      });
      setNewName('');
      showSuccess('分组已创建，请为它勾选可访问的资源站');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='space-y-5'>
      <div className='text-sm text-gray-600 dark:text-gray-400 space-y-1'>
      </div>

      {!rg.configured ? (
        <div className='p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 space-y-3'>
          <p className='text-sm text-yellow-800 dark:text-yellow-300'>
            尚未启用分组：当前所有用户都可访问全部已启用的资源站。点击启用后会创建两个初始分组——
            <b>A 组</b>（全部资源站）和 <b>B 组</b>（暂含当前全部资源站，默认注册分组），已有用户归入 A 组，权限保持不变。
          </p>
          <button
            onClick={enable}
            disabled={busy}
            className='px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg'
          >
            启用分组功能
          </button>
        </div>
      ) : (
        <>
          <div className='space-y-3'>
            {rg.groups.map((g) => (
              <GroupEditor
                key={g.id}
                group={g}
                isDefault={rg.defaultId === g.id}
                memberCount={countMembers(g.id)}
                enabledSources={enabledSources}
                otherGroups={rg.groups.filter((x) => x.id !== g.id)}
                onChanged={refreshConfig}
              />
            ))}
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <input
              value={newName}
              maxLength={20}
              onChange={(e) => setNewName(e.target.value)}
              placeholder='新分组名称（最多 20 个字符）'
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-64'
            />
            <button
              onClick={create}
              disabled={busy || !newName.trim()}
              className='px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg'
            >
              新建分组
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// 视频源配置组件
const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callSourceApi({ action, key }).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    callSourceApi({ action: 'delete', key }).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    callSourceApi({
      action: 'add',
      key: newSource.key,
      name: newSource.name,
      api: newSource.api,
      detail: newSource.detail,
    })
      .then(() => {
        setNewSource({
          name: '',
          key: '',
          api: '',
          detail: '',
          disabled: false,
          from: 'custom',
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失败', 'add', newSource);
      });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    callSourceApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ source }: { source: DataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.name}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[12rem] truncate'
          title={source.api}
        >
          {source.api}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[8rem] truncate'
          title={source.detail || '-'}
        >
          {source.detail || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(source.key)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !source.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加视频源表单 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
        >
          {showAddForm ? '取消' : '添加视频源'}
        </button>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={!newSource.name || !newSource.key || !newSource.api}
              className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 视频源表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900'>
            <tr>
              <th className='w-8' />
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                名称
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Key
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                API 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Detail 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                状态
              </th>
              <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                操作
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            autoScroll={false}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {sources.map((source) => (
                  <DraggableRow key={source.key} source={source} />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 新增站点配置组件
const SiteConfigComponent = ({ config }: { config: AdminConfig | null }) => {
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    ImageProxy: '',
  });
  // 保存状态
  const [saving, setSaving] = useState(false);

  // 检测存储类型是否为 d1 或 upstash
  const isD1Storage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
  const isUpstashStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        ImageProxy: config.SiteConfig.ImageProxy || '',
      });
    }
  }, [config]);

  // 保存站点配置
  const handleSave = async () => {
    try {
      setSaving(true);
      const resp = await fetch('/api/admin/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...siteSettings }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${resp.status}`);
      }

      showSuccess('保存成功, 请刷新页面');
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站点名称 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          站点名称
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下不可修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下不可修改)
            </span>
          )}
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
      </div>

      {/* 站点公告 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          站点公告
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下不可修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下不可修改)
            </span>
          )}
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          rows={3}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
      </div>

      {/* 搜索接口可拉取最大页数 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索接口可拉取最大页数
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站点接口缓存时间 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点接口缓存时间（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 图片代理 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isD1Storage || isUpstashStorage ? 'opacity-50' : ''
          }`}
        >
          图片代理前缀
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下不可修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下不可修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://imageproxy.example.com/?url='
          value={siteSettings.ImageProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              ImageProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        />
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          用于代理图片访问，解决跨域或访问限制问题。留空则不使用代理。
        </p>
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={saving || isD1Storage || isUpstashStorage}
          className={`px-4 py-2 ${
            saving || isD1Storage || isUpstashStorage
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white rounded-lg transition-colors`}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
};

// Cloudflare Turnstile 人机验证配置组件（仅站长）
const TurnstileConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [enabled, setEnabled] = useState(false);
  const [enableLogin, setEnableLogin] = useState(true);
  const [enableRegister, setEnableRegister] = useState(true);
  const [siteKey, setSiteKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const tc = config?.TurnstileConfig;
    if (tc) {
      setEnabled(Boolean(tc.Enabled));
      setEnableLogin(typeof tc.EnableLogin === 'boolean' ? tc.EnableLogin : true);
      setEnableRegister(
        typeof tc.EnableRegister === 'boolean' ? tc.EnableRegister : true
      );
      setSiteKey(tc.SiteKey || '');
      setSecretKey(tc.SecretKey || '');
    } else {
      setEnabled(false);
      setEnableLogin(true);
      setEnableRegister(true);
      setSiteKey('');
      setSecretKey('');
    }
  }, [config]);

  const handleSave = async () => {
    const cleanSiteKey = siteKey.trim();
    const cleanSecretKey = secretKey.trim();

    if (enabled && (!cleanSiteKey || !cleanSecretKey)) {
      showError('启用人机验证前请填写完整的 Site Key 和 Secret Key');
      return;
    }

    try {
      setSaving(true);
      const resp = await fetch('/api/admin/turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Enabled: enabled,
          EnableLogin: enableLogin,
          EnableRegister: enableRegister,
          SiteKey: cleanSiteKey,
          SecretKey: cleanSecretKey,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${resp.status}`);
      }

      if (typeof window !== 'undefined' && (window as any).RUNTIME_CONFIG) {
        const ready =
          enabled && cleanSiteKey.length > 0 && cleanSecretKey.length > 0;
        (window as any).RUNTIME_CONFIG.TURNSTILE = {
          enabled: ready,
          enableLogin: ready && enableLogin,
          enableRegister: ready && enableRegister,
          siteKey: ready ? cleanSiteKey : '',
        };
      }

      showSuccess('Cloudflare Turnstile 配置已保存');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  const keysConfigured = siteKey.trim().length > 0 && secretKey.trim().length > 0;
  const isActuallyActive = enabled && keysConfigured;

  return (
    <div className='space-y-6'>
      {/* 顶部状态说明栏 */}
      <div className='flex flex-wrap items-center justify-between gap-2 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700'>
        <div>
          <div className='flex items-center gap-2'>
            <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
              启用 Cloudflare Turnstile 人机验证
            </h4>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                isActuallyActive
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : enabled
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {isActuallyActive
                ? '运行中'
                : enabled
                ? '待填写密钥'
                : '已关闭'}
            </span>
          </div>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            开启后，可根据下方验证环境设置在登录或注册时要求通过 Cloudflare Turnstile 人机验证。
          </p>
        </div>
        <label className='relative inline-flex items-center cursor-pointer select-none'>
          <input
            type='checkbox'
            className='sr-only peer'
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <div className='w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[""] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600'></div>
        </label>
      </div>

      {/* 验证环境配置（区分登录和注册） */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 transition-opacity ${enabled ? '' : 'opacity-60'}`}>
        <div className='flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60'>
          <div>
            <h5 className='text-sm font-medium text-gray-800 dark:text-gray-200'>
              登录环境需要验证
            </h5>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后，用户登录账号前需完成 Turnstile 验证
            </p>
          </div>
          <label className='relative inline-flex items-center cursor-pointer select-none'>
            <input
              type='checkbox'
              className='sr-only peer'
              checked={enableLogin}
              onChange={(e) => setEnableLogin(e.target.checked)}
            />
            <div className='w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[""] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600'></div>
          </label>
        </div>

        <div className='flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60'>
          <div>
            <h5 className='text-sm font-medium text-gray-800 dark:text-gray-200'>
              注册环境需要验证
            </h5>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后，新用户注册账号前需完成 Turnstile 验证
            </p>
          </div>
          <label className='relative inline-flex items-center cursor-pointer select-none'>
            <input
              type='checkbox'
              className='sr-only peer'
              checked={enableRegister}
              onChange={(e) => setEnableRegister(e.target.checked)}
            />
            <div className='w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[""] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600'></div>
          </label>
        </div>
      </div>

      {/* Site Key 与 Secret Key 配置 */}
      <div className='space-y-4'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            Cloudflare Turnstile Site Key
          </label>
          <input
            type='text'
            placeholder='请输入 Cloudflare Turnstile Site Key (例如: 0x4AAAAAA...)'
            value={siteKey}
            onChange={(e) => setSiteKey(e.target.value)}
            autoComplete='off'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            用于登录/注册页面前端加载人机验证小部件的站点公钥。
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            Cloudflare Turnstile Secret Key
          </label>
          <div className='relative'>
            <input
              type={showSecretKey ? 'text' : 'password'}
              placeholder='请输入 Cloudflare Turnstile Secret Key (例如: 0x4AAAAAA...)'
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete='new-password'
              className='w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm'
            />
            <button
              type='button'
              onClick={() => setShowSecretKey((prev) => !prev)}
              className='absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors'
              aria-label={showSecretKey ? '隐藏密钥' : '显示密钥'}
            >
              {showSecretKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            用于服务端向 Cloudflare 校验验证结果的私密密钥（仅站长可见，绝不会下发到普通客户端）。
          </p>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className='flex justify-end'>
        <button
          type='button'
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 ${
            saving
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white rounded-lg transition-colors`}
        >
          {saving ? '保存中…' : '保存人机验证配置'}
        </button>
      </div>
    </div>
  );
};

function AdminPageClient() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    groupConfig: false,
    turnstileConfig: false,
    videoSource: false,
    siteConfig: false,
  });

  // 获取管理员配置
  // showLoading 用于控制是否在请求期间显示整体加载骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new Error(`获取配置失败: ${data.error}`);
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取配置失败';
      showError(msg);
      setError(msg);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 首次加载时显示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  // 切换标签展开状态
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // 【核心修复】：将 GET 请求改为要求包含特定 Header 的 POST 请求，阻断 CSRF 攻击
  const handleResetConfig = async () => {
    const { isConfirmed } = await Swal.fire({
      title: '确认重置配置',
      text: '此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    try {
      const response = await fetch(`/api/admin/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // 强制声明格式，触发预检并匹配后端的防线
        },
        body: JSON.stringify({ action: 'reset_config' }) // 发送空参数以满足 JSON 解析
      });
      
      if (!response.ok) {
        throw new Error(`重置失败: ${response.status}`);
      }
      showSuccess('重置成功，请刷新页面！');
    } catch (err) {
      showError(err instanceof Error ? err.message : '重置失败');
    }
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理员设置
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    // 错误已通过 SweetAlert2 展示，此处直接返回空
    return null;
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {/* 标题 + 重置配置按钮 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className='px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md transition-colors'
              >
                重置配置
              </button>
            )}
          </div>

          {/* 站点配置标签 */}
          <CollapsibleTab
            title='站点配置'
            icon={
              <Settings
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent config={config} />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 用户配置标签 */}
            <CollapsibleTab
              title='用户配置'
              icon={
                <Users size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>

            {/* 用户分组与权限标签（仅站长） */}
            {role === 'owner' && (
              <CollapsibleTab
                title='用户分组与权限'
                icon={
                  <Users size={20} className='text-gray-600 dark:text-gray-400' />
                }
                isExpanded={expandedTabs.groupConfig}
                onToggle={() => toggleTab('groupConfig')}
              >
                <GroupPermissionConfig config={config} refreshConfig={fetchConfig} />
              </CollapsibleTab>
            )}

            {/* Cloudflare Turnstile 人机验证配置标签（仅站长） */}
            {role === 'owner' && (
              <CollapsibleTab
                title='Cloudflare Turnstile 人机验证'
                icon={
                  <ShieldCheck
                    size={20}
                    className='text-gray-600 dark:text-gray-400'
                  />
                }
                isExpanded={expandedTabs.turnstileConfig}
                onToggle={() => toggleTab('turnstileConfig')}
              >
                <TurnstileConfigComponent
                  config={config}
                  refreshConfig={fetchConfig}
                />
              </CollapsibleTab>
            )}

            {/* 视频源配置标签 */}
            <CollapsibleTab
              title='视频源配置'
              icon={
                <Video size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}

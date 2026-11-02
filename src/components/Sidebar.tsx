'use client';

import { 
  ChevronUp, 
  Clover, 
  ExternalLink,
  Film, 
  Home, 
  Radio, 
  Search 
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useSite } from './SiteProvider';

interface SidebarContextType {
  isCollapsed: boolean;
}

// 1. Context 默认值改为 false (默认展开)
const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

// 友情链接配置列表
const FRIEND_LINKS = [
  { name: '紫月·镜', url: 'https://400823.xyz' },
  { name: 'My-Cloud', url: 'https://200805.xyz' },
  { name: 'My-CMS', url: 'https://today.400823.xyz' },
  { name: 'API中转代理', url: 'https://timis.dpdns.org' },
];

// 2. 替换为图片+文字 Logo
const Logo = () => {
  const { siteName } = useSite();
  return (
    <Link
      href='/'
      className='flex items-center justify-center h-full select-none hover:opacity-80 transition-opacity duration-200 gap-2.5'
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src='/logo.png'
        alt={siteName || 'Site Logo'}
        className='h-10 w-auto object-contain drop-shadow-sm'
      />
      <span className="text-lg font-black text-gray-900 dark:text-gray-100 tracking-wider hidden lg:block">
        {siteName}
      </span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 3. 初始化状态：默认为 false (展开状态)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }
    return false; // 默认展开
  });

  // 友情链接菜单开关状态
  const [showFriendLinks, setShowFriendLinks] = useState(false);
  const friendLinksRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const val = JSON.parse(saved);
      setIsCollapsed(val);
      window.__sidebarCollapsed = val;
    } else {
      // 首次加载主动写入展开状态
      localStorage.setItem('sidebarCollapsed', JSON.stringify(false));
      window.__sidebarCollapsed = false;
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    if (activePath) {
      setActive(activePath);
    } else {
      const getCurrentFullPath = () => {
        const queryString = searchParams.toString();
        return queryString ? `${pathname}?${queryString}` : pathname;
      };
      const fullPath = getCurrentFullPath();
      setActive(fullPath);
    }
  }, [activePath, pathname, searchParams]);

  // 监听点击外部关闭友情链接菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (friendLinksRef.current && !friendLinksRef.current.contains(event.target as Node)) {
        setShowFriendLinks(false);
      }
    };
    if (showFriendLinks) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFriendLinks]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const handleSearchClick = useCallback(() => {
    router.push('/search');
  }, [router]);

  const contextValue = {
    isCollapsed,
  };

  const menuItems = [
    {
      icon: Clover,
      label: '浏览',
      href: '/source-browser',
    },
    {
      icon: Radio,
      label: '紫月解析',
      href: '/parser',
    },
    {
      icon: Film,
      label: '最近上映',
      href: '/release-calendar',
    },
  ];

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className='hidden md:block'>
        {/* 底部导航主容器 */}
        <aside
          data-sidebar
          className={`fixed bottom-0 left-0 right-0 w-full bg-white/90 backdrop-blur-xl transition-transform duration-300 ease-in-out border-t border-gray-200/50 z-[100] shadow-[0_-10px_30px_rgba(0,0,0,0.05)] dark:bg-gray-900/90 dark:border-gray-700/50 ${
            isCollapsed ? 'translate-y-full' : 'translate-y-0'
          }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* 4. 展开/收起 提拉按钮：通过添加 hidden 类完全隐藏 */}
          <div className='hidden absolute top-0 left-8 -translate-y-full flex justify-center pointer-events-none'>
            <button
              onClick={handleToggle}
              className='pointer-events-auto flex items-center justify-center gap-1.5 px-4 py-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md rounded-t-xl border-t border-x border-gray-200/60 dark:border-gray-700/60 shadow-sm text-gray-500 hover:text-green-600 transition-colors dark:text-gray-400 dark:hover:text-green-400 text-xs font-medium'
            >
              <span>{isCollapsed ? '展开导航' : '收起导航'}</span>
              <ChevronUp
                className={`h-4 w-4 transition-transform duration-300 ${
                  isCollapsed ? '' : 'rotate-180'
                }`}
              />
            </button>
          </div>

          {/* 底部栏主体内容：相对定位容器 */}
          <div className='relative flex h-16 items-center px-4 md:px-6 max-w-screen-2xl mx-auto'>
            
            {/* 左侧 Logo */}
            <div className='absolute left-4 md:left-6 h-full flex items-center z-10'>
              <Logo />
            </div>

            {/* 居中导航项：通过增加左右 padding 防止与左右绝对定位的元素重叠 */}
            <nav className='flex w-full items-center justify-center gap-1.5 md:gap-4 overflow-x-auto no-scrollbar px-32 lg:px-48'>
              <Link
                href='/'
                onClick={() => setActive('/')}
                data-active={active === '/'}
                className='group flex items-center justify-center rounded-lg px-2.5 md:px-3 py-2 text-sm text-gray-700 hover:bg-gray-100/50 hover:text-green-600 data-[active=true]:bg-green-500/10 data-[active=true]:text-green-700 font-medium transition-colors duration-200 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 gap-2 flex-shrink-0'
              >
                <Home className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                <span>首页</span>
              </Link>
              
              <Link
                href='/search'
                onClick={(e) => {
                  e.preventDefault();
                  handleSearchClick();
                  setActive('/search');
                }}
                data-active={active === '/search'}
                className='group flex items-center justify-center rounded-lg px-2.5 md:px-3 py-2 text-sm text-gray-700 hover:bg-gray-100/50 hover:text-green-600 data-[active=true]:bg-green-500/10 data-[active=true]:text-green-700 font-medium transition-colors duration-200 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 gap-2 flex-shrink-0'
              >
                <Search className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                <span>搜索</span>
              </Link>

              {/* 视觉分隔线 */}
              <div className='w-px h-5 bg-gray-300 dark:bg-gray-700 mx-0.5 md:mx-1 flex-shrink-0'></div>

              {menuItems.map((item) => {
                const typeMatch = item.href.match(/type=([^&]+)/)?.[1];
                const tagMatch = item.href.match(/tag=([^&]+)/)?.[1];

                const decodedActive = decodeURIComponent(active);
                const decodedItemHref = decodeURIComponent(item.href);

                const isActive =
                  decodedActive === decodedItemHref ||
                  (decodedActive.startsWith('/douban') &&
                    decodedActive.includes(`type=${typeMatch}`) &&
                    tagMatch &&
                    decodedActive.includes(`tag=${tagMatch}`));
                const Icon = item.icon;
                
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setActive(item.href)}
                    data-active={isActive}
                    className='group flex items-center justify-center rounded-lg px-2.5 md:px-3 py-2 text-sm text-gray-700 hover:bg-gray-100/50 hover:text-green-600 data-[active=true]:bg-green-500/10 data-[active=true]:text-green-700 font-medium transition-colors duration-200 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 gap-2 flex-shrink-0'
                  >
                    <Icon className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* 右侧友情链接按钮与上拉菜单 */}
            <div className='absolute right-4 md:right-6 h-full flex items-center z-20' ref={friendLinksRef}>
              <button
                onClick={() => setShowFriendLinks(!showFriendLinks)}
                className={`group flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 gap-1.5 ${
                  showFriendLinks 
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400' 
                    : 'text-gray-700 hover:bg-gray-100/50 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                }`}
              >
                <ExternalLink className='h-4 w-4 flex-shrink-0' />
                <span className="hidden lg:block">外链服务</span>
              </button>

              {/* 上拉悬浮菜单 (带平滑过渡动画) */}
              <div 
                className={`absolute bottom-[calc(100%+0.5rem)] right-0 w-44 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700/80 rounded-xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.3)] py-1.5 transition-all duration-300 origin-bottom-right ${
                  showFriendLinks 
                    ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' 
                    : 'opacity-0 scale-95 translate-y-4 pointer-events-none'
                }`}
              >
                {FRIEND_LINKS.map((link, idx) => (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"            // 安全地在新标签页打开
                    rel="noopener noreferrer"  // 防止钓鱼攻击
                    onClick={() => setShowFriendLinks(false)} // 点击后自动收起菜单
                    className='block px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-green-50 dark:hover:bg-gray-800/80 hover:text-green-600 dark:hover:text-green-400 transition-colors whitespace-nowrap'
                  >
                    {link.name}
                  </a>
                ))}
              </div>
            </div>

          </div>
        </aside>

        {/* 占位宽度置为 0 */}
        <div className='w-0 h-0 hidden sidebar-offset'></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;

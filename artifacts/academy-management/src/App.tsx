import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Activity, Award, BookOpen, CalendarCheck, CalendarDays, Check, ChevronDown, ClipboardList, Clock3, GraduationCap, LayoutDashboard, LogOut, Menu, Plus, Search, Settings2, ShieldAlert, SlidersHorizontal, Users, X, KeyRound, RefreshCw, Trash2, Pencil, Printer, RotateCcw, CircleHelp, LoaderCircle, AlertTriangle, ArrowUpRight, Download, FileDown, Briefcase } from 'lucide-react';
import {
  useHealthCheck, useGetSession, useLogin, useLogout, useChangePassword, useGetSchoolState,
  useGetRevision, useGetDashboard, useSaveDocument, useDeleteDocument, useListUsers,
  useCreateUser, useUpdateUser, useDeleteUser, useResetUserPassword, useRestoreBackup,
  getGetSessionQueryKey, getGetSchoolStateQueryKey, getGetRevisionQueryKey,
  getGetDashboardQueryKey, getListUsersQueryKey, getHealthCheckQueryKey,
} from '@workspace/api-client-react';
import type { User, Course, Student, Shift, AttendanceSession, AttendanceRecord, ExamScore, Violation, Certificate, GradeValues, Role, Internship } from '@workspace/api-client-react';
import logo from '@/assets/hocvien-logo.webp';
import { normalizeBackupSnapshot } from '@/lib/backup';
import { downloadCsv, downloadJson, escapeHtml } from '@/lib/csv';
import { CourseForm } from '@/components/CourseForm';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
const nav = [
  { path: '/', label: 'Tổng quan', icon: LayoutDashboard, group: 'Điều hành' },
  { path: '/attendance', label: 'Điểm danh', icon: CalendarCheck, group: 'Đào tạo' },
  { path: '/attendance-summary', label: 'Tổng hợp chuyên cần', icon: Activity, group: 'Đào tạo' },
  { path: '/scores', label: 'Bảng điểm', icon: ClipboardList, group: 'Đào tạo' },
  { path: '/results', label: 'Kết quả học tập', icon: Award, group: 'Đào tạo' },
  { path: '/violations', label: 'Vi phạm', icon: ShieldAlert, group: 'Học viên' },
  { path: '/certificates', label: 'Chứng chỉ', icon: GraduationCap, group: 'Học viên', manager: true },
  { path: '/internships', label: 'Thực tập', icon: Briefcase, group: 'Học viên', manager: true },
  { path: '/courses', label: 'Khóa học', icon: BookOpen, group: 'Danh mục', restricted: true },
  { path: '/students', label: 'Học viên', icon: Users, group: 'Danh mục', restricted: true },
  { path: '/accounts', label: 'Tài khoản', icon: Settings2, group: 'Hệ thống', manager: true },
  { path: '/exports', label: 'Sao lưu & xuất dữ liệu', icon: FileDown, group: 'Hệ thống', manager: true },
];
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (kind: string) => parts.find(item => item.type === kind)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const roleName = (role?: Role) => role === 'quanly' ? 'Quản lý' : role === 'giangvien' ? 'Giảng viên' : 'Trợ giảng';
const prettyDate = (value?: string) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Portal /></WouterRouter></QueryClientProvider>;
}

function Portal() {
  const qc = useQueryClient();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60_000 } });
  const session = useGetSession();
  const login = useLogin();
  const logout = useLogout();
  const changePassword = useChangePassword();
  const stateQuery = useGetSchoolState({ query: { queryKey: getGetSchoolStateQueryKey(), enabled: !!session.data?.user } });
  const usersQuery = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: session.data?.user?.role === 'quanly' } });
  const revQuery = useGetRevision({ query: { queryKey: getGetRevisionQueryKey(), enabled: !!session.data?.user, refetchInterval: 20_000 } });
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), enabled: !!session.data?.user, refetchInterval: 60_000 } });
  const save = useSaveDocument();
  const deleteDoc = useDeleteDocument();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const resetPassword = useResetUserPassword();
  const restoreBackup = useRestoreBackup();
  const user = stateQuery.data?.me ?? session.data?.user ?? null;
  const [location, setLocation] = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [modal, setModal] = useState<{ title: string; body: ReactNode } | null>(null);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [resetTarget, setResetTarget] = useState('');
  const [passwordDialog, setPasswordDialog] = useState(false);
  const data = stateQuery.data?.data;
  const courses = data?.courses ?? [];
  const students = data?.students ?? [];
  const shifts = data?.shifts ?? [];
  const manager = user?.role === 'quanly';
  const canEditRoster = manager;
  const canScore = manager || user?.role === 'giangvien';
  const canManageAccounts = manager;

  useEffect(() => {
    if (!user || !revQuery.data || stateQuery.isFetching) return;
    const current = stateQuery.data?.rev ?? 0;
    if (revQuery.data.rev !== current && !document.querySelector('input:focus,textarea:focus,select:focus')) {
      setSyncing(true);
      qc.invalidateQueries({ queryKey: getGetSchoolStateQueryKey() }).finally(() => setSyncing(false));
    }
  }, [revQuery.data?.rev, stateQuery.data?.rev, stateQuery.isFetching, user, qc]);
  useEffect(() => {
    if (user?.mustChangePassword) setPasswordDialog(true);
  }, [user?.username, user?.mustChangePassword]);

  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3200); };
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetSchoolStateQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetRevisionQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
  ]);
  const saveDoc = (key: string, value: unknown, message = 'Đã lưu thay đổi') => {
    save.mutate({ data: { key, value: value as any } }, { onSuccess: async () => { await refresh(); setModal(null); setFormValues({}); notify(message); }, onError: () => notify('Không thể lưu dữ liệu. Vui lòng thử lại.') });
  };
  const deleteItem = (key: string, value: unknown, message = 'Đã xóa bản ghi') => {
    if (Array.isArray(value) && value.length === 0) {
      deleteDoc.mutate({ params: { key } }, { onSuccess: async () => { await refresh(); notify(message); }, onError: () => notify('Không thể xóa bản ghi.') });
    } else saveDoc(key, value, message);
  };
  const submitLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setLoginError('');
    login.mutate({ data: { username: String(fd.get('username') ?? ''), password: String(fd.get('password') ?? '') } }, {
      onSuccess: async () => { await qc.invalidateQueries({ queryKey: getGetSessionQueryKey() }); await qc.invalidateQueries({ queryKey: getGetSchoolStateQueryKey() }); },
      onError: () => setLoginError('Tên đăng nhập hoặc mật khẩu chưa chính xác.'),
    });
  };
  const openPassword = () => { setPasswordDialog(true); setFormValues({}); };
  const onSignOut = () => logout.mutate(undefined, { onSuccess: async () => { qc.clear(); await qc.invalidateQueries({ queryKey: getGetSessionQueryKey() }); setLocation('/'); } });
  const visibleNav = nav.filter(item => !item.manager || manager).filter(item => !item.restricted || canEditRoster);

  if (session.isLoading) return <div className="center-state"><div className="loading-mark"><LoaderCircle size={20}/></div><p>Đang kết nối hệ thống đào tạo…</p></div>;
  if (!user) return <LoginPage onSubmit={submitLogin} pending={login.isPending} error={loginError} health={health.data?.status} />;

  const active = nav.find(item => item.path === location);
  const title = active?.label ?? 'Không tìm thấy trang';
  const renderPage = () => {
    if (stateQuery.isLoading) return <LoadingView/>;
    if (stateQuery.isError || !data) return <ErrorView onRetry={() => stateQuery.refetch()}/>;
    const shared = { user, courses, students, shifts, data, dashboard: dashboard.data, saveDoc, deleteItem, notify, search, setSearch, courseFilter, setCourseFilter, formValues, setFormValues, openModal: setModal, manager, canScore, canEditRoster };
    switch (location) {
      case '/': return <Overview {...shared} />;
      case '/attendance': return <AttendancePage {...shared}/>;
      case '/attendance-summary': return <AttendanceSummary {...shared}/>;
      case '/scores': return <ScoresPage {...shared}/>;
      case '/results': return <ResultsPage {...shared}/>;
      case '/violations': return <ViolationsPage {...shared}/>;
      case '/certificates': return <CertificatesPage {...shared}/>;
      case '/internships': return manager ? <InternshipsPage {...shared}/> : <EmptyPanel title="Không có quyền truy cập" description="Chỉ Quản lý mới được phép quản lý hồ sơ thực tập."/>;
      case '/courses': return <CoursesPage {...shared}/>;
      case '/students': return <StudentsPage {...shared}/>;
      case '/accounts': return manager ? <AccountsPage {...shared} users={usersQuery.data?.users ?? stateQuery.data?.users ?? []} createUser={createUser} updateUser={updateUser} deleteUser={deleteUser} resetPassword={resetPassword} restoreBackup={restoreBackup} /> : <EmptyPanel title="Không có quyền truy cập" description="Chỉ Quản lý mới được phép quản lý tài khoản nhân sự."/>;
      case '/exports': return manager ? <ExportPage {...shared}/> : <EmptyPanel title="Không có quyền truy cập" description="Chỉ Quản lý mới được phép xuất dữ liệu học viên."/>;
      default: return <EmptyPanel title="Trang chưa tồn tại" description="Chọn một mục từ thanh điều hướng để tiếp tục." />;
    }
  };

  return <div className="portal">
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="brand"><img src={logo} alt="Học viện" /><div><strong>HỌC VIỆN</strong><span>QUẢN LÝ ĐÀO TẠO</span></div><button className="mobile-close icon-button" onClick={() => setMobileMenu(false)} aria-label="Đóng menu"><X size={18}/></button></div>
      <div className="sidebar-caption">KHÔNG GIAN LÀM VIỆC</div>
      {['Điều hành','Đào tạo','Học viên','Danh mục','Hệ thống'].map(group => {
        const items = visibleNav.filter(item => item.group === group);
        return items.length ? <div className="nav-group" key={group}><div className="nav-label">{group}</div>{items.map(item => {
          const Icon = item.icon;
          return <Link key={item.path} href={item.path} onClick={() => setMobileMenu(false)} className={`nav-link ${location === item.path ? 'nav-active' : ''}`} data-testid={`link-nav-${item.path.slice(1) || 'home'}`}><Icon size={17}/><span>{item.label}</span>{location === item.path && <span className="nav-marker"/>}</Link>;
        })}</div> : null;
      })}
      <div className="sidebar-foot"><span className="online-dot"/><span>Hệ thống đang hoạt động</span></div>
    </aside>
    {mobileMenu && <button aria-label="Đóng menu" className="mobile-scrim" onClick={() => setMobileMenu(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Mở menu"><Menu size={20}/></button><div className="crumb">Học viện <span>/</span> <b>{title}</b></div><div className="top-actions"><div className="sync-state"><span className="online-dot"/>{syncing ? 'Đang đồng bộ' : 'Dữ liệu đã đồng bộ'}</div><button className="top-icon" title="Đổi mật khẩu" onClick={openPassword} aria-label="Đổi mật khẩu"><KeyRound size={17}/></button><div className="user-chip"><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><div className="user-chip-copy"><b>{user.name}</b><span>{roleName(user.role)}</span></div><button className="top-icon logout-button" onClick={onSignOut} title="Đăng xuất" aria-label="Đăng xuất"><LogOut size={16}/></button></div></div></header>
      <section className="page-content"><div className="page-heading"><div><div className="eyebrow">HỆ THỐNG QUẢN LÝ HỌC VIÊN</div><h1>{title}</h1><p>{pageSubtitle(location)}</p></div>{location !== '/' && <div className="heading-date"><CalendarDays size={15}/>{new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>}</div>{renderPage()}</section>
    </main>
    {modal && <Modal title={modal.title} onClose={() => setModal(null)}>{modal.body}</Modal>}
    {passwordDialog && <Modal title={user.mustChangePassword ? 'Tạo mật khẩu mới' : 'Đổi mật khẩu'} description={user.mustChangePassword ? 'Vui lòng đổi mật khẩu tạm trước khi tiếp tục sử dụng hệ thống.' : 'Chọn mật khẩu mới có ít nhất 8 ký tự.'} onClose={() => !user.mustChangePassword && setPasswordDialog(false)} closeable={!user.mustChangePassword}><form className="form-stack" onSubmit={e => { e.preventDefault(); const fd=new FormData(e.currentTarget); const password=String(fd.get('newPassword')||''); if(password.length<8){notify('Mật khẩu cần ít nhất 8 ký tự.');return;} if(password!==fd.get('confirmPassword')){notify('Mật khẩu xác nhận chưa khớp.');return;} changePassword.mutate({data:{password}},{onSuccess:async()=>{await refresh();setPasswordDialog(false);notify('Đã cập nhật mật khẩu.');},onError:()=>notify('Chưa thể đổi mật khẩu. Vui lòng thử lại.')}); }}><Field label="Mật khẩu mới"><input name="newPassword" type="password" minLength={8} required autoComplete="new-password"/></Field><Field label="Nhập lại mật khẩu"><input name="confirmPassword" type="password" minLength={8} required autoComplete="new-password"/></Field><div className="modal-actions"><button type="button" className="button button-secondary" onClick={()=>setPasswordDialog(false)} disabled={user.mustChangePassword}>Để sau</button><button className="button button-primary" disabled={changePassword.isPending}>{changePassword.isPending?'Đang cập nhật…':'Cập nhật mật khẩu'}</button></div></form></Modal>}
    {notice && <div className="toast-note"><Check size={16}/>{notice}</div>}
  </div>;
}

function pageSubtitle(path:string) {
  return ({'/':'Theo dõi nhịp vận hành và những cập nhật mới nhất.','/attendance':'Ghi nhận chuyên cần theo lớp, ngày học và ca học.','/attendance-summary':'Xem tổng số buổi và tỷ lệ tham dự của từng học viên.','/scores':'Nhập điểm đánh giá và quản lý bảng điểm theo khóa.','/results':'Tổng hợp điểm thành phần, xếp hạng và kết quả hoàn thành.','/violations':'Ghi nhận sự việc và tra cứu lịch sử kỷ luật.','/certificates':'Cấp, tra cứu và quản lý chứng chỉ học viên.','/internships':'Theo dõi danh sách và tiến độ thực tập của học viên.','/courses':'Sắp xếp khóa học, lịch đào tạo và ca học.','/students':'Quản lý hồ sơ và danh sách học viên theo khóa.','/accounts':'Quản lý quyền truy cập dành cho nhân sự học viện.','/exports':'Tải báo cáo dạng CSV hoặc sao lưu toàn bộ dữ liệu.'} as Record<string,string>)[path] ?? 'Quản lý đào tạo tập trung';
}

function LoginPage({onSubmit,pending,error,health}:{onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void;pending:boolean;error:string;health?:string}) {
  const [resetOpen,setResetOpen]=useState(false);
  return <main className="login-screen"><div className="login-art"><div className="art-top"><span className="seal-dot"/><span>HỌC VIỆN · CỔNG ĐIỀU HÀNH</span></div><div className="art-content"><img src={logo} alt="Logo học viện"/><div className="art-line"/><span className="art-kicker">NỀ NẾP TỪNG NGÀY</span><h1>Đào tạo tốt,<br/><em>bắt đầu từ</em><br/>quản lý chỉn chu.</h1><p>Một không gian thống nhất để chăm sóc hành trình học tập của mỗi học viên.</p></div><div className="art-bottom"><span>HỆ THỐNG QUẢN LÝ HỌC VIÊN</span><span>HỌC VIỆN</span></div></div><div className="login-side"><div className="login-panel"><div className="login-mark"><img src={logo} alt="Học viện"/></div><div className="eyebrow">CHÀO MỪNG BẠN</div><h2>Đăng nhập hệ thống</h2><p className="login-desc">Sử dụng tài khoản được cấp bởi quản lý học viện.</p><form className="form-stack login-form" onSubmit={onSubmit}><Field label="Tên đăng nhập"><input name="username" required autoComplete="username" placeholder="Nhập tên đăng nhập"/></Field><Field label="Mật khẩu"><input name="password" type="password" required autoComplete="current-password" placeholder="Nhập mật khẩu"/></Field>{error&&<div className="form-error"><AlertTriangle size={15}/>{error}</div>}<button className="button button-primary login-submit" disabled={pending}>{pending?<><LoaderCircle size={16} className="spin"/>Đang xác thực…</>:'Đăng nhập'}<ArrowUpRight size={16}/></button></form><button className="text-button reset-trigger" onClick={()=>setResetOpen(true)}>Quên mật khẩu?</button><div className="login-foot"><span className={health==='ok'?'health-good':'health-dot'}/>{health==='ok'?'Kết nối an toàn':'Đang kiểm tra kết nối'}<span className="login-foot-sep">·</span>Học viện</div></div></div>{resetOpen&&<Modal title="Yêu cầu đặt lại mật khẩu" description="Để bảo vệ tài khoản, mật khẩu được đặt lại bởi quản lý học viện." onClose={()=>setResetOpen(false)}><div className="reset-help"><div className="empty-icon"><KeyRound size={19}/></div><p>Vui lòng liên hệ quản lý để xác minh danh tính và cấp mật khẩu mới. Sau khi đăng nhập, hệ thống sẽ yêu cầu bạn đổi mật khẩu ngay.</p><button className="button button-primary" onClick={()=>setResetOpen(false)}>Đã hiểu</button></div></Modal>}</main>;
}

type SharedProps = {user:User;courses:Course[];students:Student[];shifts:Shift[];data:any;dashboard:any;saveDoc:(key:string,value:unknown,message?:string)=>void;deleteItem:(key:string,value:unknown,message?:string)=>void;notify:(s:string)=>void;search:string;setSearch:(s:string)=>void;courseFilter:string;setCourseFilter:(s:string)=>void;formValues:Record<string,string>;setFormValues:(v:Record<string,string>)=>void;openModal:(v:{title:string;body:ReactNode}|null)=>void;manager:boolean;canScore:boolean;canEditRoster:boolean};

function Overview(p:SharedProps) {
  const dash=p.dashboard;
  const stats=[{label:'Khóa học đang quản lý',value:dash?.courseCount??p.courses.length,icon:BookOpen,tone:'navy',hint:'Lớp đào tạo'}, {label:'Học viên',value:dash?.studentCount??p.students.length,icon:Users,tone:'gold',hint:'Hồ sơ học tập'}, {label:'Vắng hôm nay',value:dash?.absencesToday??0,icon:CalendarCheck,tone:'coral',hint:'Cần theo dõi'}, {label:'Chứng chỉ đã cấp',value:dash?.certificateCount??p.data.certificates.length,icon:Award,tone:'sage',hint:'Hồ sơ chứng nhận'}];
  const studentById=new Map(p.students.map(s=>[s.id,s]));
  return <><div className="welcome-banner"><div><div className="welcome-overline"><span className="online-dot"/>BẢNG ĐIỀU KHIỂN</div><h2>Chào {p.user.name.split(' ').slice(-1)[0]},<br/><span>cùng giữ nhịp đào tạo hôm nay.</span></h2><p>Mọi thông tin quan trọng của học viện, được sắp xếp tại một nơi.</p></div><div className="welcome-stamp"><span>NGÀY HÔM NAY</span><b>{new Date().getDate().toString().padStart(2,'0')}</b><i>{new Date().toLocaleDateString('vi-VN',{month:'long',year:'numeric'})}</i></div></div><div className="stat-grid">{stats.map(s=><div className="stat-card" key={s.label}><div className={`stat-icon ${s.tone}`}><s.icon size={19}/></div><span className="stat-label">{s.label}</span><div className="stat-value">{s.value}</div><span className="stat-hint">{s.hint}</span></div>)}</div><div className="overview-grid"><div className="panel courses-panel"><div className="panel-heading"><div><span className="eyebrow">DANH MỤC ĐÀO TẠO</span><h3>Khóa học</h3></div><Link href="/courses" className="subtle-link">Xem tất cả <ArrowUpRight size={15}/></Link></div>{p.courses.length?<div className="course-list">{p.courses.slice(0,5).map((course,i)=><div className="course-row" key={course.id}><span className={`course-number n${i%4}`}>{String(i+1).padStart(2,'0')}</span><div className="course-main"><b>{course.name}</b><span>{course.startDate?`Khai giảng ${prettyDate(course.startDate)}`:'Chưa có ngày khai giảng'} · {p.students.filter(s=>s.courseId===course.id).length} học viên</span></div><span className="course-shift">{course.shiftIds.length} ca học</span></div>)}</div>:<EmptyInline title="Chưa có khóa học" description="Danh sách sẽ xuất hiện khi dữ liệu được thêm."/ >}</div><div className="panel recent-panel"><div className="panel-heading"><div><span className="eyebrow">CẦN LƯU Ý</span><h3>Vi phạm gần đây</h3></div><span className="small-count">{dash?.violationCount??p.data.violations.length} tổng</span></div>{(dash?.recentViolations??p.data.violations.slice(-5).reverse()).length?<div className="recent-list">{(dash?.recentViolations??p.data.violations.slice(-5).reverse()).map((v:Violation)=><div className="recent-row" key={v.id}><div className="recent-symbol"><ShieldAlert size={15}/></div><div><b>{studentById.get(v.studentId)?.name??'Học viên'}</b><span>{v.type} · {prettyDate(v.date)}</span></div></div>)}</div>:<EmptyInline title="Chưa có ghi nhận" description="Các cập nhật mới sẽ xuất hiện tại đây."/>}</div></div><div className="quick-access"><div className="quick-title"><span className="eyebrow">TRUY CẬP NHANH</span><h3>Việc cần làm</h3></div><Link href="/attendance" className="quick-item"><span className="quick-icon"><CalendarCheck size={18}/></span><span><b>Điểm danh lớp</b><small>Ghi nhận có mặt hôm nay</small></span><ArrowUpRight size={16}/></Link><Link href="/scores" className="quick-item"><span className="quick-icon gold"><ClipboardList size={18}/></span><span><b>Cập nhật bảng điểm</b><small>Nhập kết quả đánh giá</small></span><ArrowUpRight size={16}/></Link><Link href="/students" className="quick-item"><span className="quick-icon sage"><Users size={18}/></span><span><b>Tra cứu học viên</b><small>Xem hồ sơ theo khóa học</small></span><ArrowUpRight size={16}/></Link></div></>;
}

function AttendancePage(p:SharedProps) {
  const [courseId,setCourseId]=useState(p.courses[0]?.id??'');
  const [date,setDate]=useState(today());
  const [shiftId,setShiftId]=useState('');
  const course=p.courses.find(c=>c.id===courseId);
  const scheduledDay=course?.days.find(day=>day.date===date);
  const dayShiftIds=scheduledDay?.shiftIds.filter(id=>course?.shiftIds.includes(id))??[];
  const availableShiftIds=dayShiftIds.length?dayShiftIds:course?.shiftIds??[];
  const shiftList=p.shifts.filter(s=>availableShiftIds.includes(s.id));
  const shift=shiftList.some(s=>s.id===shiftId)?shiftId:shiftList[0]?.id??'';
  const key=`${courseId}|${date}|${shift}`;
  const baseExisting:AttendanceSession=p.data.attendance[key]??{courseId,date,shiftId:shift,instructor:p.user.role==='giangvien'?p.user.name:'',assistant:p.user.role==='trogiang'?p.user.name:'',sessionPoints:course?.defaultSessionPoints??1,records:[]};
  const [staffDraft,setStaffDraft]=useState({key:'',instructor:'',assistant:''});
  useEffect(()=>{setStaffDraft({key,instructor:baseExisting.instructor,assistant:baseExisting.assistant});},[key,baseExisting.instructor,baseExisting.assistant]);
  const existing:AttendanceSession=staffDraft.key===key?{...baseExisting,instructor:staffDraft.instructor,assistant:staffDraft.assistant}:baseExisting;
  const roster=p.students.filter(s=>s.courseId===courseId);
  const record=(studentId:string):AttendanceRecord=>existing.records.find((r:AttendanceRecord)=>r.studentId===studentId)??{studentId,status:'present',note:''};
  const saveSession=(session:AttendanceSession,message:string)=>p.saveDoc(`attendance:${key}`,{...session,courseId,date,shiftId:shift},message);
  const change=(studentId:string,status:AttendanceRecord['status'])=>{
    const records=roster.map(student=>record(student.id)).map(item=>item.studentId===studentId?{...item,status}:item);
    saveSession({...existing,records},'Đã lưu điểm danh');
  };
  const attendanceLabel=scheduledDay?.name?.trim();
  return <><div className="filter-bar"><Field label="Khóa học"><select value={courseId} onChange={e=>{setCourseId(e.target.value);setShiftId('');}}><option value="">Chọn khóa học</option>{p.courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Ngày học"><input type="date" value={date} onChange={e=>{setDate(e.target.value);setShiftId('');}}/></Field><Field label="Ca học"><select value={shift} onChange={e=>setShiftId(e.target.value)} disabled={!shiftList.length}><option value="">Chọn ca</option>{shiftList.map(s=><option key={s.id} value={s.id}>{s.name} · {s.startTime}–{s.endTime}</option>)}</select></Field><div className="filter-note"><Clock3 size={15}/> Dữ liệu được lưu theo từng ngày và ca học</div></div>{!courseId?<div className="panel table-panel"><EmptyPanel title="Chọn khóa học để bắt đầu" description="Danh sách học viên sẽ hiển thị theo khóa học đã chọn."/></div>:!shift?<div className="panel table-panel"><EmptyPanel title="Chưa có ca cho ngày này" description={scheduledDay?"Chọn ca trong phần Khóa học hoặc chọn một ngày học khác.":"Khóa học chưa có ca. Hãy cấu hình ca học trong phần Khóa học trước khi điểm danh."}/></div>:<><section className="attendance-staff panel"><div className="attendance-staff-heading"><div><span className="eyebrow">THÔNG TIN BUỔI HỌC</span><h3>{attendanceLabel||'Điểm danh theo lịch'}</h3><p>{prettyDate(date)} · {shiftList.find(s=>s.id===shift)?.name}</p></div><button className="button button-secondary button-small" onClick={()=>saveSession(existing,'Đã lưu giảng viên và trợ giảng')}><Check size={14}/>Lưu thông tin</button></div><div className="attendance-staff-fields"><Field label="Giảng viên"><input value={existing.instructor} maxLength={120} onChange={e=>setStaffDraft({key,instructor:e.target.value,assistant:existing.assistant})} placeholder="Nhập tên giảng viên"/></Field><Field label="Trợ giảng"><input value={existing.assistant} maxLength={120} onChange={e=>setStaffDraft({key,instructor:existing.instructor,assistant:e.target.value})} placeholder="Nhập tên trợ giảng"/></Field></div></section><div className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">{attendanceLabel?`${attendanceLabel} · `:''}{prettyDate(date)} · {shiftList.find(s=>s.id===shift)?.name}</span><h3>Danh sách điểm danh <span className="heading-count">{roster.length}</span></h3></div><span className="live-badge"><span className="online-dot"/>Ghi nhận theo buổi</span></div>{roster.length?<div className="table-scroll"><table><thead><tr><th>HỌC VIÊN</th><th>MÃ ĐỊNH DANH</th><th>TRẠNG THÁI</th><th>GHI CHÚ</th></tr></thead><tbody>{roster.map(s=><tr key={s.id}><td><Person student={s}/></td><td className="mono">{s.nationalId}</td><td><div className="status-options">{(['present','late','excused','unexcused'] as const).map(status=><button key={status} onClick={()=>change(s.id,status)} className={`status-choice ${record(s.id).status===status?`chosen ${status}`:''}`} data-testid={`attendance-${status}-${s.id}`}>{statusLabel(status)}</button>)}</div></td><td><input className="inline-input" aria-label={`Ghi chú ${s.name}`} defaultValue={record(s.id).note} onBlur={e=>{const records=roster.map(x=>record(x.id)).map(r=>r.studentId===s.id?{...r,note:e.target.value}:r);saveSession({...existing,records},'Đã lưu ghi chú');}} placeholder="Thêm ghi chú"/></td></tr>)}</tbody></table></div>:<EmptyInline title="Khóa học chưa có học viên" description="Hãy kiểm tra danh sách lớp hoặc chọn khóa học khác."/>}<div className="table-footer"><span>Ngày học: <b>{attendanceLabel?`${attendanceLabel} · `:''}{prettyDate(date)}</b> · Ca: <b>{shiftList.find(s=>s.id===shift)?.name}</b><br/>Giảng viên: <b>{existing.instructor||'—'}</b> · Trợ giảng: <b>{existing.assistant||'—'}</b></span><span>Tự động tính điểm chuyên cần <Check size={14}/></span></div></div></>}</>;
}
const statusLabel=(s:string)=>({present:'Có mặt',late:'Đi muộn',excused:'Có phép',unexcused:'Vắng'} as Record<string,string>)[s]??s;

function AttendanceSummary(p:SharedProps) {
  const sessions=Object.values(p.data.attendance) as AttendanceSession[];
  const rows=p.students.filter(s=>!p.courseFilter||s.courseId===p.courseFilter).filter(s=>!p.search||`${s.name} ${s.nationalId}`.toLowerCase().includes(p.search.toLowerCase())).map(student=>{const own=sessions.filter(a=>a.courseId===student.courseId);const totals=own.reduce((o,s)=>{const st=s.records.find(r=>r.studentId===student.id)?.status;if(st)o[st]=(o[st]??0)+1;return o;},{present:0,late:0,excused:0,unexcused:0} as Record<string,number>);const total=own.length;return {student,total,present:totals.present,late:totals.late,excused:totals.excused,unexcused:totals.unexcused,rate:total?Math.round((totals.present+totals.late+totals.excused)/total*100):0};});
  return <><div className="toolbar"><SearchBox value={p.search} onChange={p.setSearch} placeholder="Tìm học viên, mã định danh"/><CourseSelect courses={p.courses} value={p.courseFilter} onChange={p.setCourseFilter}/></div><div className="panel table-panel"><TableHeading kicker="BÁO CÁO CHUYÊN CẦN" title="Tổng hợp theo học viên" count={rows.length}/>{rows.length?<div className="table-scroll"><table><thead><tr><th>HỌC VIÊN</th><th>KHÓA HỌC</th><th>BUỔI HỌC</th><th>CÓ MẶT</th><th>MUỘN</th><th>VẮNG CÓ PHÉP</th><th>VẮNG</th><th>TỶ LỆ</th></tr></thead><tbody>{rows.map(r=><tr key={r.student.id}><td><Person student={r.student}/></td><td>{p.courses.find(c=>c.id===r.student.courseId)?.name??'—'}</td><td>{r.total}</td><td className="good-text">{r.present}</td><td>{r.late}</td><td>{r.excused}</td><td className="warning-text">{r.unexcused}</td><td><Rate value={r.rate}/></td></tr>)}</tbody></table></div>:<EmptyInline title="Chưa có dữ liệu chuyên cần" description="Các buổi điểm danh sẽ được tổng hợp tự động tại đây."/>}</div></>;
}

function ScoresPage(p:SharedProps) {
  const [courseId,setCourseId]=useState(p.courses[0]?.id??'');
  const roster=p.students.filter(s=>s.courseId===courseId);
  const course=p.courses.find(c=>c.id===courseId);
  const exams=Array.from(new Set((p.data.examScores as ExamScore[]).map(e=>e.exam)));
  const examLabel=(p.formValues.examFilter||exams[0]||'Bài đánh giá 1');
  const [search,setSearch]=useState('');
  const addExam=()=>{p.openModal({title:'Thêm bài đánh giá',body:<RecordForm fields={[{key:'exam',label:'Tên bài đánh giá',required:true,placeholder:'Ví dụ: Kiểm tra giữa khóa'},{key:'date',label:'Ngày đánh giá',type:'date',required:true}]} submit="Tạo bài đánh giá" onSubmit={v=>{p.setFormValues({...p.formValues,examFilter:v.exam});p.openModal(null);p.notify('Đã tạo cột đánh giá mới.');}}/>});};
  const examScores=p.data.examScores as ExamScore[];
  return <><div className="toolbar"><CourseSelect courses={p.courses} value={courseId} onChange={setCourseId}/><SearchBox value={search} onChange={setSearch} placeholder="Tìm học viên"/><div className="toolbar-spacer"/>{p.canScore&&<button className="button button-secondary" onClick={addExam}><Plus size={16}/>Thêm bài đánh giá</button>}</div><div className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">THANG ĐIỂM 10 · {course?.name??'Chọn khóa học'}</span><h3>Điểm bài đánh giá <span className="heading-count">{roster.length} học viên</span></h3></div><select className="compact-select" value={examLabel} onChange={e=>p.setFormValues({...p.formValues,examFilter:e.target.value})}>{[...exams,...(exams.includes('Bài đánh giá 1')?[]:['Bài đánh giá 1'])].map(ex=><option key={ex}>{ex}</option>)}</select></div>{roster.length?<div className="table-scroll"><table><thead><tr><th>HỌC VIÊN</th><th>MÃ ĐỊNH DANH</th><th>{examLabel.toUpperCase()}</th><th>NGÀY NHẬP</th><th>GHI CHÚ</th></tr></thead><tbody>{roster.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())).map(s=>{const score=examScores.find(e=>e.studentId===s.id&&e.exam===examLabel);return <tr key={s.id}><td><Person student={s}/></td><td className="mono">{s.nationalId}</td><td>{p.canScore?<input className="score-input" type="number" min="0" max="10" step=".1" key={`${s.id}-${score?.point}`} defaultValue={score?.point??''} placeholder="—" aria-label={`Điểm ${s.name}`} onBlur={e=>{const val=e.target.value;if(val==='')return;const next=examScores.filter(x=>x.id!==score?.id);next.push({id:score?.id??id(),studentId:s.id,exam:examLabel,point:Number(val),date:today(),note:score?.note??'',by:p.user.username});p.saveDoc('scores',next,'Đã lưu điểm số');}}/>:<span>{score?.point??'—'}</span>}</td><td>{prettyDate(score?.date)}</td><td>{score?.note||'—'}</td></tr>})}</tbody></table></div>:<EmptyInline title="Chưa có học viên trong khóa" description="Chọn khóa học khác hoặc thêm học viên vào danh sách."/>}<div className="table-footer"><span><b>Quyền nhập điểm:</b> {p.user.role==='trogiang'?'Trợ giảng không có quyền nhập điểm thi.':p.canScore?'Được phép nhập và cập nhật điểm thi.':'Chỉ xem'}</span>{course&&<button className="text-button" onClick={()=>openCourseWeights(p,course)}>Điều chỉnh cách tính điểm <ArrowUpRight size={14}/></button>}</div></div>{course&&<Gradebook p={p} course={course} roster={roster.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()))}/>}</>;
}
function Gradebook({p,course,roster}:{p:SharedProps;course:Course;roster:Student[]}) {
  const keys:(keyof GradeValues)[]=['group','bonus','evaluation','round1','round2','round3','round4'];
  const labels=['Nhóm','Điểm cộng','Đánh giá','Lần 1','Lần 2','Lần 3','Lần 4'];
  const grades=p.data.grades?.[course.id]??{};
  const write=(studentId:string,key:keyof GradeValues,value:string)=>{const current=grades[studentId]??{};const next={...grades,[studentId]:{...current,[key]:value===''?null:Number(value)}};p.saveDoc(`grades:${course.id}`,next,'Đã lưu điểm thành phần');};
  return <div className="panel table-panel gradebook-panel"><div className="panel-heading"><div><span className="eyebrow">ĐIỂM THÀNH PHẦN</span><h3>Đánh giá tổng hợp</h3></div><span className="formula-note"><CircleHelp size={14}/>Tối đa 10 điểm mỗi mục</span></div><div className="table-scroll"><table className="gradebook-table"><thead><tr><th>HỌC VIÊN</th>{labels.map(label=><th key={label}>{label.toUpperCase()}</th>)}</tr></thead><tbody>{roster.map(student=>{const grade:GradeValues=grades[student.id]??{};return <tr key={student.id}><td><Person student={student}/></td>{keys.map((key,index)=><td key={key}>{p.canScore?<input className="score-input" type="number" min="0" max="10" step=".1" key={`${student.id}-${key}-${grade[key]}`} defaultValue={grade[key]??''} placeholder="—" aria-label={`${labels[index]} của ${student.name}`} onBlur={e=>write(student.id,key,e.target.value)}/>:<span>{grade[key]??'—'}</span>}</td>)}</tr>})}</tbody></table></div></div>;
}
function openCourseWeights(p:SharedProps,course:Course){const weights=course.gradeWeights??{};p.openModal({title:'Cách tính điểm khóa học',body:<RecordForm fields={['attendance','group','bonus','evaluation','round1','round2','round3','round4'].map((k,i)=>({key:k,label:['Chuyên cần','Làm việc nhóm','Điểm cộng','Đánh giá','Lần 1','Lần 2','Lần 3','Lần 4'][i],type:'number',required:false,placeholder:'0'}))} initial={Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,String(v)]))} submit="Lưu cách tính" onSubmit={v=>p.saveDoc('courses',p.courses.map(c=>c.id===course.id?{...c,gradeWeights:Object.fromEntries(Object.entries(v).map(([k,n])=>[k,Number(n)||0]))}:c),'Đã cập nhật cách tính điểm')}/>});}

function ResultsPage(p:SharedProps) {
  const rows=p.students.filter(s=>!p.courseFilter||s.courseId===p.courseFilter).map(student=>{const course=p.courses.find(c=>c.id===student.courseId);const grade:GradeValues=p.data.grades?.[student.courseId]?.[student.id]??{};const scores=(p.data.examScores as ExamScore[]).filter(s=>s.studentId===student.id);const values:[number|undefined,number|undefined,number|undefined,number|undefined,number|undefined,number|undefined,number|undefined,number|undefined]=[grade.attendance??undefined,grade.group??undefined,grade.bonus??undefined,grade.evaluation??undefined,grade.round1??scores[0]?.point,grade.round2??scores[1]?.point,grade.round3??scores[2]?.point,grade.round4??scores[3]?.point];const weightKeys:(keyof NonNullable<Course['gradeWeights']>)[]=['attendance','group','bonus','evaluation','round1','round2','round3','round4'];const weights=course?.gradeWeights??{};const entries=values.map((value,i)=>({value,weight:weights[weightKeys[i]]??0})).filter(x=>typeof x.value==='number');const weighted=entries.reduce((sum,x)=>sum+(x.value??0)*x.weight,0);const weightTotal=entries.reduce((sum,x)=>sum+x.weight,0);const total=entries.length?Number((weightTotal?weighted/weightTotal:entries.reduce((sum,x)=>sum+(x.value??0),0)/entries.length).toFixed(2)):null;return {student,course,total,mark:course?.passMark??5};}).filter(r=>!p.search||r.student.name.toLowerCase().includes(p.search.toLowerCase()));
  return <><div className="toolbar"><SearchBox value={p.search} onChange={p.setSearch} placeholder="Tìm học viên"/><CourseSelect courses={p.courses} value={p.courseFilter} onChange={p.setCourseFilter}/><div className="toolbar-spacer"/><span className="formula-note"><CircleHelp size={15}/> Tổng điểm theo cấu hình khóa học</span></div><div className="panel table-panel"><TableHeading kicker="KẾT QUẢ ĐÀO TẠO" title="Xếp hạng học viên" count={rows.length}/>{rows.length?<div className="table-scroll"><table><thead><tr><th>HẠNG</th><th>HỌC VIÊN</th><th>KHÓA HỌC</th><th>ĐIỂM TỔNG</th><th>ĐIỂM ĐẠT</th><th>KẾT QUẢ</th></tr></thead><tbody>{[...rows].sort((a,b)=>(b.total??-1)-(a.total??-1)).map((r,i)=><tr key={r.student.id}><td><span className={`rank-chip ${i<3?'rank-top':''}`}>{String(i+1).padStart(2,'0')}</span></td><td><Person student={r.student}/></td><td>{r.course?.name??'—'}</td><td><b className="grade-total">{r.total??'—'}</b></td><td>{r.mark}</td><td>{r.total===null?<span className="tag tag-muted">Chưa có điểm</span>:r.total>=r.mark?<span className="tag tag-good">Đạt yêu cầu</span>:<span className="tag tag-danger">Chưa đạt</span>}</td></tr>)}</tbody></table></div>:<EmptyInline title="Chưa có kết quả học tập" description="Kết quả sẽ được tính khi có điểm thành phần."/>}<div className="table-footer"><span>Điểm tổng và ngưỡng đạt được cấu hình riêng theo từng khóa học.</span><span>{rows.filter(r=>r.total!==null&&r.total>=r.mark).length} đạt · {rows.filter(r=>r.total!==null&&r.total<r.mark).length} chưa đạt</span></div></div></>;
}

function ViolationsPage(p:SharedProps) {
  const records=(p.data.violations as Violation[]).filter(v=>{const s=p.students.find(st=>st.id===v.studentId);return `${s?.name} ${s?.nationalId} ${v.type} ${v.note}`.toLowerCase().includes(p.search.toLowerCase())&&(!p.courseFilter||s?.courseId===p.courseFilter);}).slice().reverse();
  const openAdd=()=>p.openModal({title:'Ghi nhận vi phạm',body:<RecordForm fields={[{key:'studentId',label:'Học viên',type:'select',options:p.students.map(s=>({value:s.id,label:`${s.name} · ${s.nationalId}`})),required:true},{key:'type',label:'Loại vi phạm',required:true,placeholder:'Ví dụ: Đi học muộn'},{key:'date',label:'Ngày ghi nhận',type:'date',required:true,initial:today()},{key:'note',label:'Nội dung chi tiết',type:'textarea'}]} submit="Lưu ghi nhận" onSubmit={v=>p.saveDoc('violations',[...p.data.violations,{id:id(),studentId:v.studentId,type:v.type,date:v.date||today(),note:v.note||'',by:p.user.username}],'Đã ghi nhận vi phạm')}/>});
  return <><div className="toolbar"><SearchBox value={p.search} onChange={p.setSearch} placeholder="Tìm tên, mã học viên, nội dung"/><CourseSelect courses={p.courses} value={p.courseFilter} onChange={p.setCourseFilter}/><div className="toolbar-spacer"/><button className="button button-primary" onClick={openAdd}><Plus size={16}/>Ghi nhận vi phạm</button></div><div className="panel table-panel"><TableHeading kicker="HỒ SƠ NỀ NẾP" title="Lịch sử vi phạm" count={records.length}/>{records.length?<div className="table-scroll"><table><thead><tr><th>HỌC VIÊN</th><th>KHÓA HỌC</th><th>PHÂN LOẠI</th><th>NGÀY</th><th>NỘI DUNG</th><th>NGƯỜI GHI</th>{p.manager&&<th/>}</tr></thead><tbody>{records.map(v=>{const s=p.students.find(st=>st.id===v.studentId);return <tr key={v.id}><td>{s?<Person student={s}/>:<span>Hồ sơ đã lưu trữ</span>}</td><td>{p.courses.find(c=>c.id===s?.courseId)?.name??'—'}</td><td><span className="tag tag-warning">{v.type}</span></td><td>{prettyDate(v.date)}</td><td className="note-cell">{v.note||'—'}</td><td>{v.by||'—'}</td>{p.manager&&<td><button className="row-action danger-hover" title="Xóa ghi nhận" aria-label="Xóa vi phạm" onClick={()=>confirmDelete(()=>p.deleteItem('violations',p.data.violations.filter((item:Violation)=>item.id!==v.id),'Đã xóa ghi nhận'))}><Trash2 size={15}/></button></td>}</tr>})}</tbody></table></div>:<EmptyInline title="Không tìm thấy ghi nhận" description="Thử thay đổi từ khóa hoặc ghi nhận sự việc mới."/>}</div></>;
}

function CertificatesPage(p:SharedProps) {
  const certs=(p.data.certificates as Certificate[]).filter(c=>{const s=p.students.find(st=>st.id===c.studentId);return `${s?.name} ${c.number} ${c.type} ${c.rank}`.toLowerCase().includes(p.search.toLowerCase())&&(!p.courseFilter||s?.courseId===p.courseFilter);}).slice().reverse();
  const saveCertificates=(arr:Certificate[],msg:string)=>p.saveDoc('certificates',arr,msg);
  const openIssue=()=>p.openModal({title:'Cấp chứng chỉ',body:<RecordForm fields={[{key:'studentId',label:'Học viên',type:'select',options:p.students.map(s=>({value:s.id,label:`${s.name} · ${s.nationalId}`})),required:true},{key:'number',label:'Số chứng chỉ',required:true,placeholder:'HV-2025-001'},{key:'type',label:'Loại chứng chỉ',required:true,placeholder:'Hoàn thành khóa học'},{key:'rank',label:'Xếp loại',placeholder:'Khá'},{key:'unit',label:'Đơn vị cấp',placeholder:'Học viện'},{key:'grade',label:'Điểm / hạng',placeholder:'8.5'},{key:'date',label:'Ngày cấp',type:'date',required:true,initial:today()},{key:'expiresAt',label:'Ngày hết hạn',type:'date'},{key:'note',label:'Ghi chú',type:'textarea'}]} submit="Cấp chứng chỉ" onSubmit={v=>saveCertificates([...p.data.certificates,{...v,id:id(),revoked:false,by:p.user.username,date:v.date||today(),expiresAt:v.expiresAt||null,note:v.note||''} as Certificate],'Đã cấp chứng chỉ')}/>});
  return <><div className="toolbar"><SearchBox value={p.search} onChange={p.setSearch} placeholder="Tìm học viên, số chứng chỉ"/><div className="toolbar-spacer"/>{p.manager&&<button className="button button-primary" onClick={openIssue}><Plus size={16}/>Cấp chứng chỉ</button>}</div><div className="panel table-panel"><TableHeading kicker="CHỨNG NHẬN ĐÀO TẠO" title="Danh sách chứng chỉ" count={certs.length}/>{certs.length?<div className="table-scroll"><table><thead><tr><th>SỐ CHỨNG CHỈ</th><th>HỌC VIÊN</th><th>LOẠI</th><th>XẾP LOẠI</th><th>NGÀY CẤP</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{certs.map(c=>{const s=p.students.find(st=>st.id===c.studentId);return <tr key={c.id}><td className="mono cert-number">{c.number}</td><td>{s?<Person student={s}/>:<span>Hồ sơ đã lưu trữ</span>}</td><td>{c.type}</td><td>{c.rank||c.grade||'—'}</td><td>{prettyDate(c.date)}</td><td>{c.revoked?<span className="tag tag-danger">Đã thu hồi</span>:<span className="tag tag-good">Còn hiệu lực</span>}</td><td><div className="row-actions">{p.manager&&<button className="row-action" title={c.revoked?'Khôi phục':'Thu hồi'} aria-label={c.revoked?'Khôi phục chứng chỉ':'Thu hồi chứng chỉ'} onClick={()=>saveCertificates(p.data.certificates.map((item:Certificate)=>item.id===c.id?{...item,revoked:!item.revoked}:item),c.revoked?'Đã khôi phục chứng chỉ':'Đã thu hồi chứng chỉ')}>{c.revoked?<RotateCcw size={15}/>:<X size={15}/>}</button>}<button className="row-action" title="In chứng chỉ" aria-label="In chứng chỉ" onClick={()=>printCertificate(c,s?.name??'Học viên')}><Printer size={15}/></button>{p.manager&&<button className="row-action danger-hover" title="Xóa" aria-label="Xóa chứng chỉ" onClick={()=>confirmDelete(()=>saveCertificates(p.data.certificates.filter((item:Certificate)=>item.id!==c.id),'Đã xóa chứng chỉ'))}><Trash2 size={15}/></button>}</div></td></tr>})}</tbody></table></div>:<EmptyInline title="Chưa có chứng chỉ" description="Chứng chỉ đã cấp sẽ được lưu và tra cứu tại đây."/>}</div></>;
}

function printCertificate(certificate:Certificate,studentName:string) {
  const printWindow=window.open('','_blank','width=1000,height=760');
  if(!printWindow){window.print();return;}
  const documentHtml=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Chứng chỉ ${escapeHtml(certificate.number)}</title><style>
    @page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#273b4a;font-family:Georgia,'Times New Roman',serif}
    .certificate{position:relative;display:flex;min-height:175mm;flex-direction:column;align-items:center;justify-content:center;border:2px solid #b89b61;padding:18mm 22mm;text-align:center}
    .certificate:before{position:absolute;inset:5mm;border:1px solid #ddd0b3;content:''}.logo{width:62px;height:62px;object-fit:contain;margin-bottom:5mm}
    .overline{font:700 10px Arial,sans-serif;letter-spacing:3px;color:#927844}.title{margin:7mm 0 2mm;font-size:36px;letter-spacing:5px}
    .subtitle{margin:0 0 7mm;font:700 12px Arial,sans-serif;letter-spacing:2px;color:#8b744a}.intro{font-size:15px}
    .name{margin:5mm 0 7mm;border-bottom:1px solid #b89b61;padding:0 16mm 3mm;font-size:30px;color:#927844}
    .detail{margin:0 0 2mm;font-size:14px}.meta{display:flex;justify-content:space-between;width:100%;margin-top:17mm;font:12px Arial,sans-serif;color:#53636b}
    .number{position:absolute;right:10mm;bottom:8mm;font:10px Arial,sans-serif;color:#7e8788}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><main class="certificate"><img class="logo" src="${escapeHtml(logo)}" alt="Logo học viện"><div class="overline">HỌC VIỆN · ĐÀO TẠO CHUYÊN NGHIỆP</div><h1 class="title">CHỨNG NHẬN</h1><h2 class="subtitle">${escapeHtml(certificate.type)}</h2><p class="intro">Học viện trân trọng chứng nhận học viên</p><div class="name">${escapeHtml(studentName)}</div><p class="detail">đã hoàn thành chương trình đào tạo${certificate.rank?` · Xếp loại ${escapeHtml(certificate.rank)}`:''}</p>${certificate.unit?`<p class="detail">Đơn vị cấp: ${escapeHtml(certificate.unit)}</p>`:''}${certificate.grade?`<p class="detail">Kết quả: ${escapeHtml(certificate.grade)}</p>`:''}<div class="meta"><span>Ngày cấp: ${escapeHtml(prettyDate(certificate.date))}</span><span>ĐẠI DIỆN HỌC VIỆN</span></div><div class="number">Số: ${escapeHtml(certificate.number)}</div></main></body></html>`;
  printWindow.document.open();printWindow.document.write(documentHtml);printWindow.document.close();
  window.setTimeout(()=>{printWindow.focus();printWindow.print();},300);
}

function CoursesPage(p:SharedProps) {
  const openCourse=(course?:Course)=>p.openModal({title:course?'Chỉnh sửa khóa học':'Thêm khóa học',body:<CourseForm course={course} shifts={p.shifts} onCancel={()=>p.openModal(null)} onSubmit={values=>{const next:Course={...values,id:course?.id??id()};p.saveDoc('courses',course?p.courses.map(c=>c.id===course.id?next:c):[...p.courses,next],course?'Đã cập nhật khóa học':'Đã thêm khóa học');}}/>});
  const manageShifts=()=>p.openModal({title:'Thêm ca học',body:<RecordForm fields={[{key:'name',label:'Tên ca',required:true,placeholder:'Ca sáng'},{key:'startTime',label:'Giờ bắt đầu',type:'time',required:true},{key:'endTime',label:'Giờ kết thúc',type:'time',required:true}]} submit="Lưu ca học" onSubmit={v=>p.saveDoc('shifts',[...p.shifts,{id:id(),name:v.name,startTime:v.startTime,endTime:v.endTime}],'Đã thêm ca học')}/>});
  return <><div className="toolbar"><SearchBox value={p.search} onChange={p.setSearch} placeholder="Tìm tên khóa học"/><div className="toolbar-spacer"/>{p.manager&&<><button className="button button-secondary" onClick={manageShifts}><Clock3 size={15}/>Thêm ca học</button><button className="button button-primary" onClick={()=>openCourse()}><Plus size={16}/>Thêm khóa học</button></>}</div><div className="shift-strip">{p.shifts.map(s=><div key={s.id} className="shift-chip"><Clock3 size={14}/><span><b>{s.name}</b><small>{s.startTime} – {s.endTime}</small></span>{p.manager&&<button className="row-action danger-hover" aria-label={`Xóa ca ${s.name}`} title="Xóa ca" onClick={()=>confirmDelete(()=>p.deleteItem('shifts',p.shifts.filter(x=>x.id!==s.id),'Đã xóa ca học'))}><Trash2 size={14}/></button>}</div>)}</div><div className="course-cards">{p.courses.filter(c=>c.name.toLowerCase().includes(p.search.toLowerCase())).map((c,i)=><div className="course-card panel" key={c.id}><div className="course-card-top"><span className={`course-number n${i%4}`}>{String(i+1).padStart(2,'0')}</span><span className="tag tag-muted">{c.attendanceMode==='session'?'Theo buổi':c.attendanceMode==='penalty'?'Trừ điểm':'Theo tỷ lệ'}</span></div><h3>{c.name}</h3><p>{c.startDate?`Khai giảng ${prettyDate(c.startDate)}`:'Chưa thiết lập ngày bắt đầu'}</p><div className="course-meta"><span><Users size={15}/>{p.students.filter(s=>s.courseId===c.id).length} học viên</span><span><Clock3 size={15}/>{c.shiftIds.length} ca học</span><span><CalendarDays size={14}/>{c.days.length} ngày học</span></div>{c.days.length>0&&<div className="course-days">{c.days.slice(0,4).map((d,index)=><span key={`${d.date}-${index}`}><b>{d.name||`Ngày học ${index+1}`}</b> · {prettyDate(d.date)}</span>)}{c.days.length>4&&<span>+{c.days.length-4} ngày khác</span>}</div>}{p.manager&&<div className="course-card-actions"><button className="button button-secondary button-small" onClick={()=>openCourse(c)}><Pencil size={14}/>Chỉnh sửa</button><button className="row-action danger-hover" title="Xóa khóa học" aria-label="Xóa khóa học" onClick={()=>confirmDelete(()=>p.deleteItem('courses',p.courses.filter(x=>x.id!==c.id),'Đã xóa khóa học'))}><Trash2 size={15}/></button></div>}</div>)}</div>{!p.courses.length&&<EmptyPanel title="Chưa có khóa học" description="Tạo khóa học đầu tiên để tổ chức lịch đào tạo."/>}</>;
}

function StudentsPage(p:SharedProps) {
  const rows=p.students.filter(s=>(!p.courseFilter||s.courseId===p.courseFilter)&&`${s.name} ${s.nationalId} ${s.force}`.toLowerCase().includes(p.search.toLowerCase()));
  const edit=(student?:Student)=>p.openModal({title:student?'Cập nhật hồ sơ học viên':'Thêm học viên',body:<RecordForm fields={[{key:'name',label:'Họ và tên',required:true,placeholder:'Họ và tên học viên'},{key:'nationalId',label:'Mã định danh',required:true,placeholder:'Số hồ sơ / CCCD'},{key:'courseId',label:'Khóa học',type:'select',options:p.courses.map(c=>({value:c.id,label:c.name})),required:true},{key:'force',label:'Đơn vị / lực lượng',placeholder:'Đơn vị công tác'}]} initial={student?{...student}:undefined} submit="Lưu hồ sơ" onSubmit={v=>{const next={id:student?.id??id(),name:v.name,nationalId:v.nationalId,courseId:v.courseId,force:v.force??''};p.saveDoc('students',student?p.students.map(s=>s.id===student.id?next:s):[...p.students,next],student?'Đã cập nhật học viên':'Đã thêm học viên');}}/>});
  return <><div className="toolbar"><SearchBox value={p.search} onChange={p.setSearch} placeholder="Tìm tên, mã hồ sơ, đơn vị"/><CourseSelect courses={p.courses} value={p.courseFilter} onChange={p.setCourseFilter}/><div className="toolbar-spacer"/>{p.manager&&<button className="button button-primary" onClick={()=>edit()}><Plus size={16}/>Thêm học viên</button>}</div><div className="panel table-panel"><TableHeading kicker="HỒ SƠ HỌC TẬP" title="Danh sách học viên" count={rows.length}/>{rows.length?<div className="table-scroll"><table><thead><tr><th>HỌC VIÊN</th><th>MÃ ĐỊNH DANH</th><th>KHÓA HỌC</th><th>ĐƠN VỊ</th>{p.manager&&<th>THAO TÁC</th>}</tr></thead><tbody>{rows.map(s=><tr key={s.id}><td><Person student={s}/></td><td className="mono">{s.nationalId}</td><td>{p.courses.find(c=>c.id===s.courseId)?.name??'—'}</td><td>{s.force||'—'}</td>{p.manager&&<td><div className="row-actions"><button className="row-action" title="Chỉnh sửa hồ sơ" aria-label="Chỉnh sửa hồ sơ" onClick={()=>edit(s)}><Pencil size={15}/></button><button className="row-action danger-hover" title="Xóa học viên" aria-label="Xóa học viên" onClick={()=>confirmDelete(()=>p.deleteItem('students',p.students.filter(x=>x.id!==s.id),'Đã xóa học viên'))}><Trash2 size={15}/></button></div></td>}</tr>)}</tbody></table></div>:<EmptyInline title="Không tìm thấy học viên" description="Thử điều chỉnh từ khóa tìm kiếm hoặc chọn khóa học khác."/>}</div></>;
}

function AccountsPage(p:SharedProps & {users:User[];createUser:any;updateUser:any;deleteUser:any;resetPassword:any;restoreBackup:any}) {
  const edit=(user?:User)=>p.openModal({title:user?'Cập nhật tài khoản':'Tạo tài khoản nhân sự',body:<RecordForm fields={[{key:'username',label:'Tên đăng nhập',required:true,placeholder:'vietanh',disabled:!!user},{key:'name',label:'Họ và tên',required:true,placeholder:'Họ và tên'},{key:'role',label:'Vai trò',type:'select',options:[{value:'quanly',label:'Quản lý'},{value:'giangvien',label:'Giảng viên'},{value:'trogiang',label:'Trợ giảng'}],required:true},...(!user?[{key:'password',label:'Mật khẩu khởi tạo',type:'password',required:true}]:[])]} initial={user?{username:user.username,name:user.name,role:user.role}:undefined} submit={user?'Cập nhật tài khoản':'Tạo tài khoản'} onSubmit={v=>{if(user)p.updateUser.mutate({username:user.username,data:{name:v.name,role:v.role as Role}},{onSuccess:()=>{p.openModal(null);p.notify('Đã cập nhật tài khoản.');queryClient.invalidateQueries({queryKey:getListUsersQueryKey()});queryClient.invalidateQueries({queryKey:getGetSchoolStateQueryKey()});},onError:()=>p.notify('Không thể cập nhật tài khoản.')});else p.createUser.mutate({data:{username:v.username,name:v.name,role:v.role as Role,password:v.password}},{onSuccess:()=>{p.openModal(null);p.notify('Đã tạo tài khoản.');queryClient.invalidateQueries({queryKey:getListUsersQueryKey()});queryClient.invalidateQueries({queryKey:getGetSchoolStateQueryKey()});},onError:()=>p.notify('Không thể tạo tài khoản. Tên đăng nhập có thể đã tồn tại.')});}}/>});
  const reset=(username:string)=>p.openModal({title:'Đặt lại mật khẩu',body:<RecordForm fields={[{key:'password',label:'Mật khẩu mới',type:'password',required:true},{key:'confirm',label:'Xác nhận mật khẩu',type:'password',required:true}]} submit="Đặt lại mật khẩu" onSubmit={v=>{if(v.password!==v.confirm){p.notify('Mật khẩu xác nhận chưa khớp.');return;}p.resetPassword.mutate({username,data:{password:v.password}},{onSuccess:()=>{p.openModal(null);p.notify('Đã đặt lại mật khẩu.');},onError:()=>p.notify('Không thể đặt lại mật khẩu.')});}}/>});
  const remove=(username:string)=>confirmDelete(()=>p.deleteUser.mutate({username},{onSuccess:()=>{p.notify('Đã xóa tài khoản.');queryClient.invalidateQueries({queryKey:getListUsersQueryKey()});queryClient.invalidateQueries({queryKey:getGetSchoolStateQueryKey()});},onError:()=>p.notify('Không thể xóa tài khoản.')}),'Xóa tài khoản này?');
  const restoreFile=async(file?:File)=>{if(!file)return;try{const snapshot=normalizeBackupSnapshot(JSON.parse(await file.text()));if(!snapshot){p.notify('Tệp sao lưu không đúng định dạng.');return;}if(!window.confirm('Khôi phục bản sao lưu sẽ thay thế dữ liệu hiện tại. Bạn muốn tiếp tục?'))return;p.restoreBackup.mutate({data:{snapshot}},{onSuccess:async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:getGetSchoolStateQueryKey()}),queryClient.invalidateQueries({queryKey:getGetDashboardQueryKey()}),queryClient.invalidateQueries({queryKey:getGetRevisionQueryKey()}),queryClient.invalidateQueries({queryKey:getListUsersQueryKey()})]);p.notify('Đã khôi phục dữ liệu từ bản sao lưu.');},onError:()=>p.notify('Không thể khôi phục. Hãy kiểm tra định dạng tệp sao lưu.')});}catch{p.notify('Tệp sao lưu không đúng định dạng JSON.');}};
  return <><div className="toolbar"><div className="toolbar-info"><span className="eyebrow">PHÂN QUYỀN HỆ THỐNG</span><span>Quản lý tài khoản và vai trò truy cập</span></div><div className="toolbar-spacer"/><label className="button button-secondary restore-label"><RotateCcw size={15}/>Khôi phục sao lưu<input className="hidden-file" aria-label="Chọn tệp sao lưu" type="file" accept=".json,application/json" onChange={e=>restoreFile(e.currentTarget.files?.[0])}/></label><button className="button button-primary" onClick={()=>edit()}><Plus size={16}/>Tạo tài khoản</button></div><div className="panel table-panel"><TableHeading kicker="NHÂN SỰ HỌC VIỆN" title="Tài khoản truy cập" count={p.users.length}/>{p.users.length?<div className="table-scroll"><table><thead><tr><th>NHÂN SỰ</th><th>TÊN ĐĂNG NHẬP</th><th>VAI TRÒ</th><th>MẬT KHẨU</th><th>THAO TÁC</th></tr></thead><tbody>{p.users.map(u=><tr key={u.username}><td><div className="person"><div className="person-avatar">{u.name.slice(0,1)}</div><b>{u.name}</b></div></td><td className="mono">{u.username}</td><td><span className={`tag ${u.role==='quanly'?'tag-gold':'tag-muted'}`}>{roleName(u.role)}</span></td><td>{u.mustChangePassword?<span className="tag tag-warning">Cần đổi</span>:<span className="muted-text">Đã thiết lập</span>}</td><td><div className="row-actions"><button className="row-action" title="Chỉnh sửa" aria-label="Chỉnh sửa tài khoản" onClick={()=>edit(u)}><Pencil size={15}/></button><button className="row-action" title="Đặt lại mật khẩu" aria-label="Đặt lại mật khẩu" onClick={()=>reset(u.username)}><KeyRound size={15}/></button><button className="row-action danger-hover" title="Xóa" aria-label="Xóa tài khoản" onClick={()=>remove(u.username)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>:<EmptyInline title="Chưa có tài khoản nhân sự" description="Tạo tài khoản để cấp quyền truy cập cho đội ngũ."/>}</div><div className="role-cards"><div><ShieldAlert size={17}/><b>Quản lý</b><span>Toàn quyền quản trị và cấu hình.</span></div><div><BookOpen size={17}/><b>Giảng viên</b><span>Điểm danh, nhập điểm và ghi nhận vi phạm.</span></div><div><Users size={17}/><b>Trợ giảng</b><span>Điểm danh và ghi nhận vi phạm.</span></div></div></>;
}

const internshipStatuses: Internship['status'][] = ['Đang thực tập','Đã hoàn thành','Tạm dừng'];

function InternshipsPage(p:SharedProps) {
  const [query,setQuery]=useState('');
  const records:Internship[]=p.data.internships??[];
  const normalized=query.trim().toLocaleLowerCase('vi');
  const filtered=records.filter(record=>`${record.name} ${record.nationalId} ${record.position} ${record.militaryRank} ${record.status}`.toLocaleLowerCase('vi').includes(normalized));
  const totals={
    active:records.filter(record=>record.status==='Đang thực tập').length,
    complete:records.filter(record=>record.status==='Đã hoàn thành').length,
    paused:records.filter(record=>record.status==='Tạm dừng').length,
  };
  const openForm=(record?:Internship)=>{
    p.openModal({
      title:record?'Chỉnh sửa hồ sơ thực tập':'Thêm hồ sơ thực tập',
      body:<InternshipForm
        initial={record}
        onCancel={()=>p.openModal(null)}
        onSubmit={values=>{
          const nationalId=values.nationalId.trim().toLocaleLowerCase();
          if(records.some(item=>item.id!==record?.id&&item.nationalId.trim().toLocaleLowerCase()===nationalId)){
            p.notify('Số CCCD này đã có trong danh sách thực tập.');
            return;
          }
          const next:Internship={id:record?.id??id(),...values};
          const updated=record?records.map(item=>item.id===record.id?next:item):[...records,next];
          p.saveDoc('internships',updated,record?'Đã cập nhật hồ sơ thực tập':'Đã thêm hồ sơ thực tập');
        }}
      />,
    });
  };
  const confirmDelete=(record:Internship)=>{
    p.openModal({
      title:'Xóa hồ sơ thực tập',
      body:<div className="internship-confirm">
        <p>Bạn có chắc chắn muốn xóa hồ sơ của <strong>{record.name}</strong>? Thao tác này không thể hoàn tác.</p>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" data-testid="button-cancel-delete-internship" onClick={()=>p.openModal(null)}>Hủy</button>
          <button type="button" className="button button-danger" data-testid={`button-confirm-delete-internship-${record.id}`} onClick={()=>p.saveDoc('internships',records.filter(item=>item.id!==record.id),'Đã xóa hồ sơ thực tập')}>Xóa hồ sơ</button>
        </div>
      </div>,
    });
  };
  return <div className="internship-page">
    <section className="internship-overview panel">
      <div className="internship-overview-copy">
        <span className="eyebrow">HỒ SƠ THỰC TẬP</span>
        <h2>Theo dõi hành trình<br/><em>trải nghiệm thực tế.</em></h2>
        <p>Quản lý thông tin thực tập và cập nhật trạng thái của từng học viên.</p>
      </div>
      <div className="internship-overview-side">
        <div className="internship-total"><span>TỔNG HỒ SƠ</span><b data-testid="text-internship-total">{records.length.toString().padStart(2,'0')}</b></div>
        <div className="internship-stat-line"><span><i className="internship-dot working"/>Đang thực tập</span><b data-testid="text-internship-active-count">{totals.active}</b></div>
        <div className="internship-stat-line"><span><i className="internship-dot completed"/>Đã hoàn thành</span><b data-testid="text-internship-complete-count">{totals.complete}</b></div>
        <div className="internship-stat-line"><span><i className="internship-dot paused"/>Tạm dừng</span><b data-testid="text-internship-paused-count">{totals.paused}</b></div>
      </div>
      <div className="internship-orbit" aria-hidden="true"><span/><span/><span/></div>
    </section>
    <div className="internship-toolbar">
      <label className="internship-search">
        <Search size={17}/>
        <input aria-label="Tìm hồ sơ thực tập" data-testid="input-search-internships" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Tìm theo họ tên, CCCD, chức vụ…"/>
        {query&&<button type="button" aria-label="Xóa tìm kiếm" data-testid="button-clear-internship-search" onClick={()=>setQuery('')}><X size={15}/></button>}
      </label>
      <span className="internship-result-count" data-testid="text-internship-result-count">{filtered.length} hồ sơ</span>
      <button type="button" className="button button-primary internship-add" data-testid="button-add-internship" onClick={()=>openForm()}><Plus size={16}/>Thêm hồ sơ</button>
    </div>
    <section className="panel internship-list">
      <div className="internship-list-heading">
        <div><span className="eyebrow">DANH SÁCH QUẢN LÝ</span><h3>Hồ sơ thực tập</h3></div>
        <span className="internship-list-caption">Thông tin học viên &nbsp;·&nbsp; tình trạng hiện tại</span>
      </div>
      {filtered.length>0?<div className="table-scroll internship-table-scroll">
        <table className="internship-table">
          <thead><tr><th>HỌ VÀ TÊN</th><th>CCCD / MÃ ĐỊNH DANH</th><th>CHỨC VỤ</th><th>QUÂN HÀM</th><th>TÌNH TRẠNG</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>{filtered.map((record,index)=><tr key={record.id} data-testid={`row-internship-${record.id}`}>
            <td><div className="internship-name-cell"><span className={`internship-index index-${index%4}`}>{String(index+1).padStart(2,'0')}</span><span className="internship-value-name" data-testid={`text-internship-name-${record.id}`}>{record.name}</span></div></td>
            <td><span className="internship-id-value" data-testid={`text-internship-national-id-${record.id}`}>{record.nationalId}</span></td>
            <td><span className="internship-position" data-testid={`text-internship-position-${record.id}`}>{record.position||'—'}</span></td>
            <td><span className="internship-rank" data-testid={`text-internship-rank-${record.id}`}>{record.militaryRank||'—'}</span></td>
            <td><span className={`internship-status ${record.status==='Đang thực tập'?'is-working':record.status==='Đã hoàn thành'?'is-completed':'is-paused'}`} data-testid={`status-internship-${record.id}`}><i/>{record.status}</span></td>
            <td><div className="internship-row-actions">
              <button type="button" aria-label={`Chỉnh sửa ${record.name}`} title="Chỉnh sửa hồ sơ" className="internship-action" data-testid={`button-edit-internship-${record.id}`} onClick={()=>openForm(record)}><Pencil size={15}/></button>
              <button type="button" aria-label={`Xóa ${record.name}`} title="Xóa hồ sơ" className="internship-action delete" data-testid={`button-delete-internship-${record.id}`} onClick={()=>confirmDelete(record)}><Trash2 size={15}/></button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>:<div className="internship-empty" data-testid="empty-internships">
        <div className="internship-empty-mark"><Briefcase size={21}/></div>
        <span className="eyebrow">{query?'KHÔNG CÓ KẾT QUẢ':'CHƯA CÓ HỒ SƠ'}</span>
        <h3>{query?'Không tìm thấy hồ sơ phù hợp':'Bắt đầu với hồ sơ đầu tiên'}</h3>
        <p>{query?'Thử tìm bằng tên, số CCCD, chức vụ hoặc tình trạng khác.':'Thêm thông tin học viên để theo dõi quá trình thực tập tại đây.'}</p>
        {query?<button type="button" className="button button-secondary" data-testid="button-reset-internship-search" onClick={()=>setQuery('')}>Xóa từ khóa tìm kiếm</button>:<button type="button" className="button button-primary" data-testid="button-add-first-internship" onClick={()=>openForm()}><Plus size={15}/>Thêm hồ sơ</button>}
      </div>}
      <div className="internship-list-foot"><span><i className="online-dot"/>Danh sách được cập nhật sau mỗi lần lưu</span><span>{filtered.length} / {records.length} hồ sơ</span></div>
    </section>
  </div>;
}

function InternshipForm({initial,onCancel,onSubmit}:{initial?:Internship;onCancel:()=>void;onSubmit:(values:Omit<Internship,'id'>)=>void}) {
  const [values,setValues]=useState<Omit<Internship,'id'>>({
    name:initial?.name??'',
    nationalId:initial?.nationalId??'',
    position:initial?.position??'',
    militaryRank:initial?.militaryRank??'',
    status:initial?.status??'Đang thực tập',
  });
  const update=(key:keyof typeof values,value:string)=>setValues(current=>({...current,[key]:value}));
  return <form className="form-stack internship-form" data-testid="form-internship" onSubmit={event=>{event.preventDefault();onSubmit({...values,name:values.name.trim(),nationalId:values.nationalId.trim(),position:values.position.trim(),militaryRank:values.militaryRank.trim()});}}>
    <div className="internship-form-intro"><span className="internship-form-icon"><Briefcase size={17}/></span><p>{initial?'Cập nhật thông tin và tình trạng thực tập hiện tại.':'Điền thông tin định danh để tạo hồ sơ theo dõi mới.'}</p></div>
    <Field label="Họ và tên"><input data-testid="input-internship-name" autoFocus required maxLength={200} value={values.name} onChange={event=>update('name',event.target.value)} placeholder="Nhập họ và tên học viên"/></Field>
    <Field label="CCCD / Mã định danh"><input data-testid="input-internship-national-id" required maxLength={20} value={values.nationalId} onChange={event=>update('nationalId',event.target.value)} placeholder="Nhập số CCCD"/></Field>
    <div className="internship-form-columns">
      <Field label="Chức vụ"><input data-testid="input-internship-position" required maxLength={120} value={values.position} onChange={event=>update('position',event.target.value)} placeholder="Nhập chức vụ"/></Field>
      <Field label="Quân hàm"><input data-testid="input-internship-military-rank" required maxLength={120} value={values.militaryRank} onChange={event=>update('militaryRank',event.target.value)} placeholder="Nhập quân hàm"/></Field>
    </div>
    <Field label="Tình trạng"><select data-testid="select-internship-status" required value={values.status} onChange={event=>update('status',event.target.value)}>{internshipStatuses.map(status=><option key={status} value={status}>{status}</option>)}</select></Field>
    <div className="modal-actions"><button type="button" className="button button-secondary" data-testid="button-cancel-internship" onClick={onCancel}>Hủy</button><button type="submit" className="button button-primary" data-testid="button-save-internship"><Check size={15}/>{initial?'Lưu thay đổi':'Lưu hồ sơ'}</button></div>
  </form>;
}

function ExportPage(p:SharedProps) {
  const studentName=(studentId:string)=>p.students.find(student=>student.id===studentId)?.name??'Hồ sơ đã lưu trữ';
  const courseName=(courseId:string)=>p.courses.find(course=>course.id===courseId)?.name??'—';
  const attendanceRows=Object.entries(p.data.attendance).flatMap(([key,session]:[string,AttendanceSession])=>session.records.map(record=>[courseName(session.courseId),session.date,session.shiftId,studentName(record.studentId),record.status,record.note]));
  const scoreRows=(p.data.examScores as ExamScore[]).map(score=>[studentName(score.studentId),score.exam,score.point,score.date,score.note,score.by]);
  const gradeRows=Object.entries(p.data.grades as Record<string,Record<string,GradeValues>>).flatMap(([courseId,grades])=>Object.entries(grades).map(([studentId,grade])=>[courseName(courseId),studentName(studentId),grade.group,grade.bonus,grade.evaluation,grade.round1,grade.round2,grade.round3,grade.round4]));
  const violationRows=(p.data.violations as Violation[]).map(item=>[studentName(item.studentId),item.type,item.date,item.note,item.by]);
  const certificateRows=(p.data.certificates as Certificate[]).map(item=>[item.number,studentName(item.studentId),item.type,item.rank,item.unit,item.grade,item.date,item.expiresAt,item.revoked?'Đã thu hồi':'Còn hiệu lực']);
  const courseRows=p.courses.map(course=>[course.name,course.startDate,course.shiftIds.join('; '),course.days.map(day=>`${day.date} ${day.name??''}`).join('; '),course.attendanceMode,course.passMark]);
  const studentRows=p.students.map(student=>[student.name,student.nationalId,courseName(student.courseId),student.force]);
  const internshipRows=((p.data.internships??[]) as Internship[]).map(item=>[item.name,item.nationalId,item.position,item.militaryRank,item.status]);
  const backup=()=>downloadJson(`sao-luu-hoc-vien-${today()}.json`,{version:1,exportedAt:new Date().toISOString(),data:p.data});
  return <>
    <div className="export-callout panel">
      <div className="export-callout-icon"><FileDown size={20}/></div>
      <div><span className="eyebrow">SAO LƯU TOÀN BỘ</span><h3>Tạo bản sao lưu dữ liệu</h3><p>Tệp JSON bao gồm hồ sơ học viên, thực tập (có CCCD), khóa học, điểm danh, điểm số, vi phạm và chứng chỉ. Mật khẩu và phiên đăng nhập không được xuất.</p></div>
      <button className="button button-primary" onClick={backup}><Download size={16}/>Tải bản sao lưu</button>
    </div>
    <div className="export-grid">
      <ExportCard title="Danh sách học viên" description="Hồ sơ, mã định danh, khóa học và đơn vị." onExport={()=>downloadCsv('danh-sach-hoc-vien.csv',['Họ tên','Mã định danh','Khóa học','Đơn vị'],studentRows)}/>
      <ExportCard title="Danh sách thực tập" description="Họ tên, CCCD, chức vụ, quân hàm và tình trạng." onExport={()=>downloadCsv('danh-sach-thuc-tap.csv',['Họ và tên','CCCD','Chức vụ','Quân hàm','Tình trạng'],internshipRows)}/>
      <ExportCard title="Khóa học & lịch" description="Lịch khai giảng, ca học và cách tính chuyên cần." onExport={()=>downloadCsv('khoa-hoc.csv',['Khóa học','Ngày khai giảng','Ca','Lịch học','Cách tính chuyên cần','Điểm đạt'],courseRows)}/>
      <ExportCard title="Điểm danh" description="Trạng thái từng học viên theo buổi học." onExport={()=>downloadCsv('diem-danh.csv',['Khóa học','Ngày','Ca','Học viên','Trạng thái','Ghi chú'],attendanceRows)}/>
      <ExportCard title="Điểm thi" description="Điểm từng bài đánh giá đã nhập." onExport={()=>downloadCsv('diem-thi.csv',['Học viên','Bài đánh giá','Điểm','Ngày','Ghi chú','Người nhập'],scoreRows)}/>
      <ExportCard title="Bảng điểm tổng hợp" description="Bảy cột điểm thành phần theo khóa học." onExport={()=>downloadCsv('bang-diem-tong-hop.csv',['Khóa học','Học viên','Nhóm','Điểm cộng','Đánh giá','Lần 1','Lần 2','Lần 3','Lần 4'],gradeRows)}/>
      <ExportCard title="Vi phạm" description="Lịch sử sự việc và nội dung ghi nhận." onExport={()=>downloadCsv('lich-su-vi-pham.csv',['Học viên','Loại vi phạm','Ngày','Nội dung','Người ghi'],violationRows)}/>
      <ExportCard title="Chứng chỉ" description="Danh sách cấp mới, còn hiệu lực và đã thu hồi." onExport={()=>downloadCsv('danh-sach-chung-chi.csv',['Số chứng chỉ','Học viên','Loại','Xếp loại','Đơn vị','Điểm / hạng','Ngày cấp','Hết hạn','Trạng thái'],certificateRows)}/>
    </div>
    <p className="export-footnote"><ShieldAlert size={14}/> Chỉ xuất các dữ liệu mà tài khoản Quản lý được phép xem. Tệp CSV có thể mở bằng Excel.</p>
  </>;
}

function ExportCard({title,description,onExport}:{title:string;description:string;onExport:()=>void}) {
  return <div className="export-card panel"><div className="export-card-icon"><Download size={17}/></div><div><h3>{title}</h3><p>{description}</p></div><button className="button button-secondary" onClick={onExport}>Tải CSV</button></div>;
}

function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}) {return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
function RecordForm({fields,initial={},submit,onSubmit}:{fields:{key:string;label:string;type?:string;required?:boolean;placeholder?:string;options?:{value:string;label:string}[];initial?:string;disabled?:boolean}[];initial?:Record<string,any>;submit:string;onSubmit:(values:Record<string,string>)=>void}) {
  const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(fields.map(f=>{const raw=String(initial[f.key]??f.initial??(f.type==='checkbox'?'false':''));return [f.key,f.type==='date'?raw.slice(0,10):raw];})));
  return <form className="form-stack" onSubmit={e=>{e.preventDefault();onSubmit(values);}}>{fields.map(f=><Field key={f.key} label={f.label}>{f.type==='textarea'?<textarea value={values[f.key]??''} onChange={e=>setValues({...values,[f.key]:e.target.value})} placeholder={f.placeholder} rows={3}/>:f.type==='select'?<select required={f.required} value={values[f.key]??''} onChange={e=>setValues({...values,[f.key]:e.target.value})}><option value="">Chọn…</option>{f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==='checkbox'?<select value={values[f.key]??'false'} onChange={e=>setValues({...values,[f.key]:e.target.value})}><option value="true">Bật</option><option value="false">Tắt</option></select>:<input type={f.type??'text'} required={f.required} disabled={f.disabled} value={values[f.key]??''} onChange={e=>setValues({...values,[f.key]:e.target.value})} placeholder={f.placeholder} min={f.type==='number'?0:undefined} max={f.type==='number'?100:undefined}/>}</Field>)}<div className="modal-actions"><button type="submit" className="button button-primary">{submit}</button></div></form>;
}
function Modal({title,description,children,onClose,closeable=true}:{title:string;description?:string;children:ReactNode;onClose:()=>void;closeable?:boolean}) {return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&closeable)onClose();}}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><h2 id="modal-title">{title}</h2>{description&&<p>{description}</p>}</div>{closeable&&<button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={18}/></button>}</div>{children}</div></div>;}
function EmptyPanel({title,description}:{title:string;description:string}) {return <div className="empty-panel"><div className="empty-icon"><ClipboardList size={22}/></div><b>{title}</b><p>{description}</p></div>;}
function EmptyInline({title,description}:{title:string;description:string}) {return <div className="empty-inline"><div className="empty-icon"><ClipboardList size={19}/></div><div><b>{title}</b><p>{description}</p></div></div>;}
function LoadingView(){return <div className="panel loading-panel"><div className="skeleton wide"/><div className="skeleton medium"/><div className="skeleton table-skeleton"/><div className="skeleton table-skeleton"/></div>;}
function ErrorView({onRetry}:{onRetry:()=>void}){return <div className="panel error-panel"><div className="empty-icon error-icon"><AlertTriangle size={21}/></div><h3>Chưa thể tải dữ liệu</h3><p>Kiểm tra kết nối rồi thử tải lại. Thông tin đã lưu vẫn an toàn.</p><button className="button button-secondary" onClick={onRetry}><RefreshCw size={15}/>Thử lại</button></div>;}
function Person({student}:{student:Student}) {return <div className="person" data-testid={`student-${student.id}`}><div className="person-avatar">{student.name.split(' ').slice(-1)[0]?.slice(0,1).toUpperCase()}</div><b>{student.name}</b></div>;}
function Rate({value}:{value:number}){return <div className="rate-cell"><div className="rate-track"><i style={{width:`${value}%`}}/></div><span>{value}%</span></div>;}
function SearchBox({value,onChange,placeholder}:{value:string;onChange:(v:string)=>void;placeholder:string}){return <label className="searchbox"><Search size={16}/><input aria-label={placeholder} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>{value&&<button type="button" aria-label="Xóa tìm kiếm" onClick={()=>onChange('')}><X size={14}/></button>}</label>;}
function CourseSelect({courses,value,onChange}:{courses:Course[];value:string;onChange:(v:string)=>void}){return <label className="select-filter"><SlidersHorizontal size={15}/><select aria-label="Lọc theo khóa học" value={value} onChange={e=>onChange(e.target.value)}><option value="">Tất cả khóa học</option>{courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><ChevronDown size={14}/></label>;}
function TableHeading({kicker,title,count}:{kicker:string;title:string;count:number}){return <div className="panel-heading"><div><span className="eyebrow">{kicker}</span><h3>{title} <span className="heading-count">{count}</span></h3></div></div>;}
function confirmDelete(action:()=>void,message='Bạn có chắc chắn muốn xóa bản ghi này?'){if(window.confirm(message))action();}

export default App;

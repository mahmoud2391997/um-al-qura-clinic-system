import './style.css';
import LanguageProvider from './components/LanguageProvider';
export const metadata={title:'أم القرى | إدارة المجمع',description:'نظام إدارة مجمع أم القرى الطبي'};
export default function Layout({children}){return <html lang="ar" dir="rtl"><body><LanguageProvider>{children}</LanguageProvider></body></html>}

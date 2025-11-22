'use client';

import { ReactNode } from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { LayoutDashboard, Printer, Settings, FilePenLine, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const getPageTitle = () => {
    if (pathname === '/admin') return 'Dashboard';
    if (pathname.startsWith('/admin/printers')) return 'Printers';
    if (pathname.startsWith('/admin/edit-requests')) return 'Edit Requests';
    if (pathname.startsWith('/admin/settings')) return 'Settings';
    return 'Admin';
  };

  const handleLogout = async () => {
    // In this simplified model, logout just reloads the page, forcing re-authentication.
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background">
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2">
              <div className="bg-primary/20 p-2 rounded-lg">
                <Printer className="w-6 h-6 text-primary" />
              </div>
              <h1 className="text-xl font-bold">PrintAdmin</h1>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/admin'}>
                  <Link href="/admin">
                    <LayoutDashboard />
                    Dashboard
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith('/admin/printers')}
                >
                  <Link href="/admin/printers">
                    <Printer />
                    Printers
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith('/admin/edit-requests')}
                >
                  <Link href="/admin/edit-requests">
                    <FilePenLine />
                    Edit Requests
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith('/admin/settings')}
                >
                  <Link href="/admin/settings">
                    <Settings />
                    Settings
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
           <SidebarFooter>
            <Button variant="ghost" className="justify-start gap-2" onClick={handleLogout}>
              <LogOut />
              Logout
            </Button>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
            <SidebarTrigger className="md:hidden" />
             <div className="flex items-center justify-between w-full">
                <h1 className="text-xl font-semibold hidden md:block">{getPageTitle()}</h1>
                {/* Desktop trigger */}
                <SidebarTrigger className="hidden md:flex" />
                <div className="block md:hidden">
                    <Button variant="ghost" size="sm" onClick={handleLogout}>
                        <LogOut className="w-4 h-4 mr-2" /> Logout
                    </Button>
                </div>
            </div>
          </header>
          <main className="flex-1 p-4 sm:px-6 sm:py-0">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

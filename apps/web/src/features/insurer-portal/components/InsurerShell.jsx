import { Fragment, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Building2, LogOut, X } from 'lucide-react';
import { useStore } from '@/store';
import { cn } from '@/lib/cn';
import { PORTAL_CONTENT_ID, portalPath } from '@/features/insurer-portal/portal';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/primitives/breadcrumb';
import { Toaster } from '@/components/ui/primitives/sonner';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Separator } from '@/components/ui/primitives/separator';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
  useSidebar,
} from '@/components/ui/primitives/sidebar';

/**
 * The insurer workspace frame: section navigation, where the current screen
 * sits (`trail`, from the section down to the screen; an entry with `to` is a
 * link back), and the confirmations raised by the screens inside it.
 */
export default function InsurerShell({ insurerName, insurerLogo, sections, activeSection, trail = [], children }) {
  const navigate = useNavigate();
  const triggerRef = useRef(null);
  const endStaffSession = useStore((state) => state.endStaffSession);

  function signOut() {
    endStaffSession();
    navigate('/admin-login');
  }

  return (
    <SidebarProvider className="insurer-shell bg-muted text-foreground">
      <a href={`#${PORTAL_CONTENT_ID}`} className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <InsurerNavigation
        insurerName={insurerName}
        insurerLogo={insurerLogo}
        sections={sections}
        activeSection={activeSection}
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}
      />
      <SidebarInset className="min-w-0 bg-muted/60">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger ref={triggerRef} aria-label="Toggle navigation" className="size-9 shrink-0" />
            <Separator orientation="vertical" className="!h-5" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem className="hidden sm:inline-flex">Workspace</BreadcrumbItem>
                {trail.map(({ label, to }, index) => {
                  const current = index === trail.length - 1;
                  return (
                    <Fragment key={label}>
                      <BreadcrumbSeparator className="hidden sm:block" />
                      {/* A phone shows only the current screen; its page header carries the way back. */}
                      <BreadcrumbItem className={cn('min-w-0', !current && 'hidden sm:inline-flex')}>
                        {current
                          ? <BreadcrumbPage className="truncate font-medium">{label}</BreadcrumbPage>
                          : <BreadcrumbLink asChild><Link to={to}>{label}</Link></BreadcrumbLink>}
                      </BreadcrumbItem>
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Badge data-testid="portal-role" variant="outline" className="border-border font-normal text-muted-foreground">Insurer</Badge>
            <Button variant="ghost" size="sm" aria-label="Sign out" onClick={signOut}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        <div id={PORTAL_CONTENT_ID} tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6 p-4 outline-none sm:p-6 lg:p-8">
          {children}
        </div>
      </SidebarInset>
      {/* The product has one light theme; without this the toast would follow the device's. */}
      <Toaster theme="light" position="top-center" />
    </SidebarProvider>
  );
}

function InsurerNavigation({ insurerName, insurerLogo, sections, activeSection, onCloseAutoFocus }) {
  const { setOpenMobile } = useSidebar();
  const initials = insurerName.split(' ').slice(0, 2).map((part) => part[0]).join('');

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border" onMobileCloseAutoFocus={onCloseAutoFocus}>
      <SidebarHeader className="relative gap-6 px-4 pb-4 pt-6 group-data-[collapsible=icon]:px-2">
        <Button variant="ghost" size="icon-sm" aria-label="Close navigation" onClick={() => setOpenMobile(false)} className="absolute right-2 top-2 md:hidden"><X /></Button>
        <SidebarMenu className="pr-5 md:pr-0">
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="hover:bg-transparent">
              <Link to="/" aria-label="InsurShield customer site">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">I</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold tracking-tight">InsurShield</span>
                  <span className="text-xs text-muted-foreground">Insurer workspace</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-sidebar-border bg-muted/60 p-3 group-data-[collapsible=icon]:hidden">
          {insurerLogo ? <img src={insurerLogo} alt="" className="size-9 shrink-0 rounded-md bg-background object-contain p-1" /> : <Building2 className="size-5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{insurerName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Motor insurance</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-3 group-data-[collapsible=icon]:px-2">
          <SidebarGroupLabel className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Insurer navigation">
              <SidebarMenu className="gap-1">
                {sections.map(({ id, label, icon: SectionIcon, badge }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton asChild isActive={activeSection === id} tooltip={label} className="h-11 px-3 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground">
                      <Link
                        to={portalPath.section(id)}
                        aria-label={label}
                        aria-describedby={badge > 0 ? `insurer-section-${id}-count` : undefined}
                        aria-current={activeSection === id ? 'page' : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <SectionIcon className="size-4" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {/* Read with the link it belongs to, not as a stray number after it. */}
                    {badge > 0 && (
                      <SidebarMenuBadge id={`insurer-section-${id}-count`} className="right-3 top-3 bg-sidebar-accent text-sidebar-accent-foreground" aria-hidden="true">
                        {badge}{' '}<span className="sr-only">to do</span>
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-4 p-3 group-data-[collapsible=icon]:p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Customer site">
              <Link to="/" aria-label="Customer site"><ArrowUpRight /><span>Customer site</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Separator className="group-data-[collapsible=icon]:hidden" />
        <div className="flex min-w-0 items-center gap-3 p-1 group-data-[collapsible=icon]:p-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">{initials}</span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">{insurerName}</p>
            <p className="text-xs text-muted-foreground">Insurer account</p>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/primitives/empty';
import { Input } from '@/components/ui/primitives/input';
import { Label } from '@/components/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Switch } from '@/components/ui/primitives/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives/table';
import { Textarea } from '@/components/ui/primitives/textarea';

const NO_INSURER = '__no_insurer__';
const NO_TEAM = '__no_team__';

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super administrator', scope: 'platform' },
  { value: 'ADMIN', label: 'Administrator', scope: 'platform' },
  { value: 'INSURER_ADMIN', label: 'Insurer administrator', scope: 'insurer' },
  { value: 'QUOTE_OFFICER', label: 'Quote officer', scope: 'insurer' },
  { value: 'CLAIMS_OFFICER', label: 'Claims and NCD officer', scope: 'insurer' },
  { value: 'SUPPORT', label: 'Support', scope: 'insurer' },
  { value: 'FINANCE', label: 'Finance', scope: 'insurer' },
  { value: 'COMPLIANCE_READ_ONLY', label: 'Compliance, read only', scope: 'insurer' },
  { value: 'INSURER_USER', label: 'Insurer portal user', scope: 'insurer' },
];

const roleByValue = new Map(ROLE_OPTIONS.map((role) => [role.value, role]));
const roleByLabel = new Map(ROLE_OPTIONS.map((role) => [role.label, role]));

const initialStaffForm = (scope, insurerId) => ({
  fullName: '',
  email: '',
  role: scope === 'insurer' ? 'QUOTE_OFFICER' : 'ADMIN',
  insurerId: scope === 'insurer' ? insurerId || '' : '',
  teamId: '',
  isActive: true,
  reason: '',
});

const initialTeamForm = (scope, insurerId) => ({
  insurerId: scope === 'insurer' ? insurerId || '' : '',
  name: '',
  reason: '',
});

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function canonicalRole(role) {
  return roleByValue.get(role)?.value || roleByLabel.get(role)?.value || role || '';
}

function roleLabel(role) {
  return roleByValue.get(canonicalRole(role))?.label || role || 'Unassigned';
}

function isInsurerRole(role) {
  return roleByValue.get(canonicalRole(role))?.scope === 'insurer';
}

function statusLabel(isActive) {
  return isActive ? 'Active' : 'Inactive';
}

function selectValue(value, emptyValue) {
  return value || emptyValue;
}

/**
 * Administrative member and team controls shared by the platform console and
 * insurer portal. Permission enforcement remains server-side; this section
 * exposes the management actions and clearly reports an API refusal.
 */
export default function StaffManagement({ insurers = [], scope = 'platform', insurerId, api, onChanged }) {
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [staffForm, setStaffForm] = useState(() => initialStaffForm(scope, insurerId));
  const [teamForm, setTeamForm] = useState(() => initialTeamForm(scope, insurerId));

  const accessibleInsurers = useMemo(
    () => (scope === 'insurer' ? insurers.filter((insurer) => insurer.id === insurerId) : insurers),
    [insurers, insurerId, scope],
  );

  const load = useCallback(async () => {
    if (!api?.staff?.listUsers || !api?.staff?.listTeams) {
      setLoadError('Staff management is not available in this environment.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const [users, loadedTeams] = await Promise.all([api.staff.listUsers(), api.staff.listTeams()]);
      setStaff(Array.isArray(users) ? users : []);
      setTeams(Array.isArray(loadedTeams) ? loadedTeams : []);
    } catch (error) {
      setLoadError(errorMessage(error, 'We could not load staff and teams. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [load]);

  const teamsFor = useCallback((selectedInsurerId) => (
    teams.filter((team) => team.insurerId === selectedInsurerId)
  ), [teams]);

  const closeDialog = () => {
    if (saving) return;
    setDialog(null);
    setDialogError(null);
  };

  const openCreateStaff = () => {
    setNotice(null);
    setDialogError(null);
    setStaffForm(initialStaffForm(scope, insurerId));
    setDialog({ type: 'create-staff' });
  };

  const openEditStaff = (member) => {
    setNotice(null);
    setDialogError(null);
    setStaffForm({
      fullName: member.fullName || '',
      email: member.email || '',
      role: canonicalRole(member.role),
      insurerId: member.insurerId || '',
      teamId: member.team?.id || '',
      isActive: Boolean(member.isActive),
      reason: '',
    });
    setDialog({ type: 'edit-staff', member });
  };

  const openResendInvitation = (member) => {
    setNotice(null);
    setDialogError(null);
    setStaffForm((form) => ({ ...form, reason: '' }));
    setDialog({ type: 'resend-invitation', member });
  };

  const openCreateTeam = () => {
    setNotice(null);
    setDialogError(null);
    setTeamForm(initialTeamForm(scope, insurerId));
    setDialog({ type: 'create-team' });
  };

  const openEditTeam = (team) => {
    setNotice(null);
    setDialogError(null);
    setTeamForm({ insurerId: team.insurerId, name: team.name || '', reason: '' });
    setDialog({ type: 'edit-team', team });
  };

  const openDeleteTeam = (team) => {
    setNotice(null);
    setDialogError(null);
    setTeamForm({ insurerId: team.insurerId, name: team.name || '', reason: '' });
    setDialog({ type: 'delete-team', team });
  };

  const refreshAfterChange = async (message) => {
    await load();
    await onChanged?.();
    setNotice(message);
    setDialog(null);
  };

  const selectedStaffInsurerId = isInsurerRole(staffForm.role)
    ? (scope === 'insurer' ? insurerId || '' : staffForm.insurerId)
    : '';

  const updateStaffField = (field, value) => {
    setStaffForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'role' && !isInsurerRole(value)) {
        next.insurerId = '';
        next.teamId = '';
      }
      if (field === 'insurerId') next.teamId = '';
      return next;
    });
  };

  const saveStaff = async (event) => {
    event.preventDefault();
    const isEditing = dialog?.type === 'edit-staff';
    const selectedRole = canonicalRole(staffForm.role);
    const selectedInsurer = isInsurerRole(selectedRole)
      ? (scope === 'insurer' ? insurerId : staffForm.insurerId)
      : null;
    const selectedTeam = isInsurerRole(selectedRole) ? (staffForm.teamId || null) : null;

    if (!staffForm.reason.trim()) {
      setDialogError('Give a brief reason for this access change.');
      return;
    }
    if (!selectedRole) {
      setDialogError('Choose a staff role.');
      return;
    }
    if (isInsurerRole(selectedRole) && !selectedInsurer) {
      setDialogError('Choose the insurer this staff member works for.');
      return;
    }

    setSaving(true);
    setDialogError(null);
    try {
      if (!isEditing) {
        if (!staffForm.fullName.trim() || !staffForm.email.trim()) {
          setDialogError('Enter the staff member’s full name and email address.');
          return;
        }
        await api.staff.createUser({
          fullName: staffForm.fullName.trim(),
          email: staffForm.email.trim(),
          role: selectedRole,
          ...(selectedInsurer ? { insurerId: selectedInsurer } : {}),
          ...(selectedTeam ? { teamId: selectedTeam } : {}),
          reason: staffForm.reason.trim(),
        });
        await refreshAfterChange('Staff member created. Their invitation is being sent.');
        return;
      }

      const member = dialog.member;
      const changes = { reason: staffForm.reason.trim() };
      const oldRole = canonicalRole(member.role);
      const oldInsurer = member.insurerId || null;
      const oldTeam = member.team?.id || null;

      if (selectedRole !== oldRole) changes.role = selectedRole;
      if (selectedInsurer !== oldInsurer) changes.insurerId = selectedInsurer;
      if (selectedTeam !== oldTeam) changes.teamId = selectedTeam;
      if (staffForm.isActive !== Boolean(member.isActive)) changes.isActive = staffForm.isActive;

      if (Object.keys(changes).length === 1) {
        setDialogError('Choose at least one access change before saving.');
        return;
      }

      await api.staff.updateUser(member.id, changes);
      await refreshAfterChange(`${member.fullName}’s access has been updated.`);
    } catch (error) {
      setDialogError(errorMessage(error, 'We could not save this staff member. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const resendInvitation = async (event) => {
    event.preventDefault();
    const reason = staffForm.reason.trim();
    if (!reason) {
      setDialogError('Give a brief reason for sending another invitation.');
      return;
    }

    setSaving(true);
    setDialogError(null);
    try {
      await api.staff.resendInvitation(dialog.member.id, reason);
      await refreshAfterChange(`A new invitation has been sent to ${dialog.member.email}.`);
    } catch (error) {
      setDialogError(errorMessage(error, 'We could not resend the invitation. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const saveTeam = async (event) => {
    event.preventDefault();
    const isEditing = dialog?.type === 'edit-team';
    const selectedInsurer = scope === 'insurer' ? insurerId : teamForm.insurerId;

    if (!teamForm.name.trim()) {
      setDialogError('Enter a team name.');
      return;
    }
    if (!selectedInsurer) {
      setDialogError('Choose the insurer this team belongs to.');
      return;
    }
    if (!teamForm.reason.trim()) {
      setDialogError('Give a brief reason for this team change.');
      return;
    }

    setSaving(true);
    setDialogError(null);
    try {
      if (isEditing) {
        await api.staff.updateTeam(dialog.team.id, { name: teamForm.name.trim(), reason: teamForm.reason.trim() });
        await refreshAfterChange('Team name updated.');
      } else {
        await api.staff.createTeam({ insurerId: selectedInsurer, name: teamForm.name.trim(), reason: teamForm.reason.trim() });
        await refreshAfterChange('Team created.');
      }
    } catch (error) {
      setDialogError(errorMessage(error, 'We could not save this team. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteTeam = async (event) => {
    event.preventDefault();
    const reason = teamForm.reason.trim();
    if (!reason) {
      setDialogError('Give a brief reason for deleting this team.');
      return;
    }

    setSaving(true);
    setDialogError(null);
    try {
      await api.staff.removeTeam(dialog.team.id, reason);
      await refreshAfterChange('Team deleted.');
    } catch (error) {
      setDialogError(errorMessage(error, 'We could not delete this team. Move its members first, then try again.'));
    } finally {
      setSaving(false);
    }
  };

  const memberCountByTeam = useMemo(() => {
    const counts = new Map();
    staff.forEach((member) => {
      if (!member.team?.id) return;
      counts.set(member.team.id, (counts.get(member.team.id) || 0) + 1);
    });
    return counts;
  }, [staff]);

  const renderRoleSelect = () => (
    <div className="grid gap-2">
      <Label htmlFor="staff-role">Role</Label>
      <Select value={staffForm.role} onValueChange={(value) => updateStaffField('role', value)}>
        <SelectTrigger id="staff-role" className="w-full">
          <SelectValue placeholder="Choose a role" />
        </SelectTrigger>
        <SelectContent>
          {ROLE_OPTIONS.filter((role) => scope === 'platform' || role.scope === 'insurer').map((role) => (
            <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderInsurerAndTeamFields = () => {
    if (!isInsurerRole(staffForm.role)) return null;
    const applicableTeams = teamsFor(selectedStaffInsurerId);
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {scope === 'platform' && (
          <div className="grid gap-2">
            <Label htmlFor="staff-insurer">Insurer</Label>
            <Select value={selectValue(staffForm.insurerId, NO_INSURER)} onValueChange={(value) => updateStaffField('insurerId', value === NO_INSURER ? '' : value)}>
              <SelectTrigger id="staff-insurer" className="w-full"><SelectValue placeholder="Choose an insurer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_INSURER}>Choose an insurer</SelectItem>
                {accessibleInsurers.map((insurer) => <SelectItem key={insurer.id} value={insurer.id}>{insurer.tradingName || insurer.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="staff-team">Team <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Select value={selectValue(staffForm.teamId, NO_TEAM)} onValueChange={(value) => updateStaffField('teamId', value === NO_TEAM ? '' : value)} disabled={!selectedStaffInsurerId}>
            <SelectTrigger id="staff-team" className="w-full"><SelectValue placeholder="No team" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEAM}>No team</SelectItem>
              {applicableTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  return (
    <section aria-labelledby="staff-management-title" className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Access control</p>
          <h2 id="staff-management-title" className="mt-1 text-2xl font-semibold tracking-tight">Staff and teams</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Set the right role and team for each person. Every access change requires a reason and is recorded for review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw aria-hidden="true" />} Refresh
          </Button>
          <Button type="button" onClick={openCreateStaff}><UserPlus aria-hidden="true" /> Add staff member</Button>
        </div>
      </div>

      {notice && <Alert className="border-primary/20 bg-primary/[0.05] text-foreground"><ShieldCheck aria-hidden="true" /><AlertTitle>Updated</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Staff information is unavailable</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">{loadError}<Button type="button" size="sm" variant="outline" onClick={() => void load()}>Try again</Button></AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-primary" aria-hidden="true" /> Staff members</CardTitle>
            <CardDescription>Roles determine what each person can see and do. Names and emails are held by their identity account.</CardDescription>
            <CardAction><Badge variant="outline">{staff.length} total</Badge></CardAction>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading staff members…</div>
            ) : staff.length === 0 ? (
              <Empty className="min-h-48 border-border">
                <EmptyHeader><EmptyMedia variant="icon"><UsersRound /></EmptyMedia><EmptyTitle>No staff members yet</EmptyTitle><EmptyDescription>Add the first team member and send them an invitation to set their password.</EmptyDescription></EmptyHeader>
                <Button type="button" onClick={openCreateStaff}><UserPlus aria-hidden="true" /> Add staff member</Button>
              </Empty>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Role and scope</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {staff.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="whitespace-normal"><p className="font-medium text-foreground">{member.fullName}</p><p className="mt-0.5 text-xs text-muted-foreground">{member.email}</p></TableCell>
                      <TableCell className="whitespace-normal"><p>{roleLabel(member.role)}</p><p className="mt-0.5 text-xs text-muted-foreground">{member.insurerName || 'InsurShield'}{member.team?.name ? ` · ${member.team.name}` : ''}</p></TableCell>
                      <TableCell><Badge variant={member.isActive ? 'default' : 'outline'}>{statusLabel(member.isActive)}</Badge></TableCell>
                      <TableCell><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${member.fullName}`} title="Edit access" onClick={() => openEditStaff(member)}><Pencil aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Resend invitation to ${member.fullName}`} title="Resend invitation" disabled={!member.isActive} onClick={() => openResendInvitation(member)}><Mail aria-hidden="true" /></Button></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Teams</CardTitle>
            <CardDescription>Use teams to organise insurer staff without changing their role.</CardDescription>
            <CardAction><Button type="button" size="sm" onClick={openCreateTeam}><Plus aria-hidden="true" /> Add team</Button></CardAction>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading teams…</div> : teams.length === 0 ? (
              <Empty className="min-h-40 border-border p-6"><EmptyHeader><EmptyTitle>No teams yet</EmptyTitle><EmptyDescription>Create a team before assigning people to it.</EmptyDescription></EmptyHeader></Empty>
            ) : teams.map((team) => (
              <article key={team.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3">
                <div className="min-w-0"><p className="font-medium">{team.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{team.insurerName || accessibleInsurers.find((insurer) => insurer.id === team.insurerId)?.name || 'Insurer'} · {memberCountByTeam.get(team.id) || 0} member{(memberCountByTeam.get(team.id) || 0) === 1 ? '' : 's'}</p></div>
                <div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${team.name}`} title="Rename team" onClick={() => openEditTeam(team)}><Pencil aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${team.name}`} title="Delete team" onClick={() => openDeleteTeam(team)}><Trash2 aria-hidden="true" /></Button></div>
              </article>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialog?.type === 'create-staff' || dialog?.type === 'edit-staff'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{dialog?.type === 'edit-staff' ? 'Edit staff access' : 'Add staff member'}</DialogTitle><DialogDescription>{dialog?.type === 'edit-staff' ? 'Change this person’s role, insurer team, or account status. Their name and email are managed by their identity account.' : 'The staff member receives a password-set invitation after their account is created.'}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={saveStaff}>
            {dialog?.type === 'create-staff' ? <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="staff-full-name">Full name</Label><Input id="staff-full-name" value={staffForm.fullName} onChange={(event) => updateStaffField('fullName', event.target.value)} autoComplete="name" required /></div><div className="grid gap-2"><Label htmlFor="staff-email">Email address</Label><Input id="staff-email" type="email" value={staffForm.email} onChange={(event) => updateStaffField('email', event.target.value)} autoComplete="email" required /></div></div> : <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm"><p className="font-medium">{staffForm.fullName}</p><p className="text-muted-foreground">{staffForm.email}</p></div>}
            {renderRoleSelect()}
            {renderInsurerAndTeamFields()}
            {dialog?.type === 'edit-staff' && <div className="flex items-center justify-between rounded-xl border border-border px-3 py-3"><div><Label htmlFor="staff-active">Account active</Label><p className="mt-1 text-xs text-muted-foreground">Turning this off signs the person out on every device.</p></div><Switch id="staff-active" checked={staffForm.isActive} onCheckedChange={(checked) => updateStaffField('isActive', checked)} aria-label="Account active" /></div>}
            <div className="grid gap-2"><Label htmlFor="staff-reason">Reason for this change</Label><Textarea id="staff-reason" value={staffForm.reason} onChange={(event) => updateStaffField('reason', event.target.value)} placeholder="For example, joins the claims team" maxLength={1000} required /></div>
            {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
            <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose><Button type="submit" disabled={saving}>{saving && <Spinner />}{dialog?.type === 'edit-staff' ? 'Save access' : 'Create and invite'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === 'resend-invitation'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resend invitation</DialogTitle><DialogDescription>Send a new password-set link to {dialog?.member?.email}. The old link may no longer be usable.</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={resendInvitation}><div className="grid gap-2"><Label htmlFor="invitation-reason">Reason</Label><Textarea id="invitation-reason" value={staffForm.reason} onChange={(event) => updateStaffField('reason', event.target.value)} placeholder="For example, the first email was not received" maxLength={1000} required /></div>{dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}<DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose><Button type="submit" disabled={saving}>{saving && <Spinner />}Send invitation</Button></DialogFooter></form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === 'create-team' || dialog?.type === 'edit-team'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.type === 'edit-team' ? 'Rename team' : 'Add a team'}</DialogTitle><DialogDescription>Teams help organise insurer staff. They do not grant permissions on their own.</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={saveTeam}>
            {scope === 'platform' && dialog?.type === 'create-team' && <div className="grid gap-2"><Label htmlFor="team-insurer">Insurer</Label><Select value={selectValue(teamForm.insurerId, NO_INSURER)} onValueChange={(value) => setTeamForm((form) => ({ ...form, insurerId: value === NO_INSURER ? '' : value }))}><SelectTrigger id="team-insurer" className="w-full"><SelectValue placeholder="Choose an insurer" /></SelectTrigger><SelectContent><SelectItem value={NO_INSURER}>Choose an insurer</SelectItem>{accessibleInsurers.map((insurer) => <SelectItem key={insurer.id} value={insurer.id}>{insurer.tradingName || insurer.name}</SelectItem>)}</SelectContent></Select></div>}
            <div className="grid gap-2"><Label htmlFor="team-name">Team name</Label><Input id="team-name" value={teamForm.name} onChange={(event) => setTeamForm((form) => ({ ...form, name: event.target.value }))} maxLength={120} required /></div>
            <div className="grid gap-2"><Label htmlFor="team-reason">Reason for this change</Label><Textarea id="team-reason" value={teamForm.reason} onChange={(event) => setTeamForm((form) => ({ ...form, reason: event.target.value }))} placeholder="For example, create a dedicated claims team" maxLength={1000} required /></div>
            {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
            <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose><Button type="submit" disabled={saving}>{saving && <Spinner />}{dialog?.type === 'edit-team' ? 'Save team' : 'Create team'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === 'delete-team'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {dialog?.team?.name}?</DialogTitle><DialogDescription>This cannot be undone. You must move every staff member out of the team before it can be deleted.</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={deleteTeam}><div className="grid gap-2"><Label htmlFor="delete-team-reason">Reason for deletion</Label><Textarea id="delete-team-reason" value={teamForm.reason} onChange={(event) => setTeamForm((form) => ({ ...form, reason: event.target.value }))} placeholder="For example, this team is no longer used" maxLength={1000} required /></div>{dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}<DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose><Button type="submit" variant="destructive" disabled={saving}>{saving && <Spinner />}Delete team</Button></DialogFooter></form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

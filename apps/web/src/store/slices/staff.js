import { NOW, newReference, updateById } from '../shared';

/**
 * Small browser-backed counterpart to the staff APIs. In HTTP mode these
 * collections are simply the last scoped response from the server; in mock
 * mode they let the same management screens demonstrate the real workflow.
 */
const initialTeams = [
  { id: 'team-prestige-underwriting', insurerId: '1', insurerName: 'Prestige Assurance', name: 'Underwriting', createdAt: '2026-01-15T09:00:00.000Z' },
  { id: 'team-prestige-claims', insurerId: '1', insurerName: 'Prestige Assurance', name: 'Claims', createdAt: '2026-01-15T09:00:00.000Z' },
];

const initialUsers = [
  {
    id: 'staff-prestige-admin', fullName: 'Chanda Mwale', email: 'insurer@insurshield.zm', role: 'INSURER_ADMIN',
    insurerId: '1', insurerName: 'Prestige Assurance', isActive: true,
    team: { id: 'team-prestige-underwriting', name: 'Underwriting' }, lastLoginAt: '2026-11-10T08:30:00.000Z', createdAt: '2026-01-15T09:00:00.000Z',
  },
];

export const createStaffSlice = (set) => ({
  staffUsers: initialUsers,
  staffTeams: initialTeams,
  setStaffUsers: (staffUsers) => set({ staffUsers }),
  setStaffTeams: (staffTeams) => set({ staffTeams }),
  addStaffUser: (user) => set((state) => ({
    staffUsers: [{ ...user, id: user.id || newReference('STAFF'), createdAt: user.createdAt || NOW(), lastLoginAt: null }, ...state.staffUsers],
  })),
  updateStaffUser: (id, changes) => set((state) => ({
    staffUsers: updateById(state.staffUsers, id, (user) => ({ ...user, ...changes })),
  })),
  addStaffTeam: (team) => set((state) => ({
    staffTeams: [{ ...team, id: team.id || newReference('TEAM'), createdAt: team.createdAt || NOW() }, ...state.staffTeams],
  })),
  updateStaffTeam: (id, changes) => set((state) => ({
    staffTeams: updateById(state.staffTeams, id, (team) => ({ ...team, ...changes })),
    staffUsers: state.staffUsers.map((user) => user.team?.id === id ? { ...user, team: { ...user.team, name: changes.name ?? user.team.name } } : user),
  })),
  removeStaffTeam: (id) => set((state) => ({ staffTeams: state.staffTeams.filter((team) => team.id !== id) })),
});

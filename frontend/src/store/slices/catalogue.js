import { INSURER_RATES, PIA_CONFIG } from '@/domain/insurers';
import { NOW, newReference, updateById, withTimestamp } from '../shared';

/** Platform configuration owned by the InsurShield administrator: the insurer catalogue and the PIA premium floor. */
export const createCatalogueSlice = (set, get) => ({
  piaConfig: { ...PIA_CONFIG },
  setPiaConfig: (config) => set((state) => ({ piaConfig: { ...state.piaConfig, ...config } })),

  insurersList: INSURER_RATES,
  addInsurer: (insurer) => set((state) => ({ insurersList: [...state.insurersList, { ...insurer, id: newReference('INS') }] })),
  updateInsurer: (insurerId, updates) =>
    set((state) => ({ insurersList: updateById(state.insurersList, insurerId, (insurer) => withTimestamp({ ...insurer, ...updates })) })),
  setInsurerStatus: (insurerId, status) => get().updateInsurer(insurerId, { status }),
  // Soft delete retains historical quotes, policies and claims while
  // removing the insurer from every new quote-request distribution.
  deleteInsurer: (insurerId) => get().updateInsurer(insurerId, { status: 'Deleted', deletedAt: NOW() }),
});

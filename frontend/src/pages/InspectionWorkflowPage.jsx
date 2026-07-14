import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';

const INSPECTION_STATUSES = [
  { id: 'Requested', label: 'Requested', icon: 'pending', color: 'bg-blue-100 text-blue-800' },
  { id: 'Scheduled', label: 'Scheduled', icon: 'calendar_today', color: 'bg-amber-100 text-amber-800' },
  { id: 'Inspector Assigned', label: 'Inspector Assigned', icon: 'person_pin', color: 'bg-purple-100 text-purple-800' },
  { id: 'In Progress', label: 'In Progress', icon: 'fact_check', color: 'bg-orange-100 text-orange-800' },
  { id: 'Completed', label: 'Completed', icon: 'task_alt', color: 'bg-teal-100 text-teal-800' },
  { id: 'Report Ready', label: 'Report Ready', icon: 'description', color: 'bg-indigo-100 text-indigo-800' },
  { id: 'Approved', label: 'Approved', icon: 'verified', color: 'bg-green-100 text-green-800' },
  { id: 'Failed', label: 'Failed', icon: 'cancel', color: 'bg-red-100 text-red-800' },
];

const MOCK_INSPECTIONS = [
  {
    id: 'INS-001', status: 'In Progress', vehicle: '2020 Toyota Hilux', plate: 'BAA 1234',
    scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    inspectorName: 'Mr. Chiluba Mwamba', inspectorPhone: '0971 234 567',
    location: 'InsurShield Inspection Centre, Lusaka Central',
    insurer: 'Global Guard Insurance',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Physical inspection required before quotation. Bring your White Book and Driver\'s License.',
    photos: {},
  },
];

const PHOTO_SLOTS = [
  { id: 'front', label: 'Front View', icon: 'directions_car' },
  { id: 'back', label: 'Rear View', icon: 'directions_car' },
  { id: 'left', label: 'Left Side', icon: 'directions_car' },
  { id: 'right', label: 'Right Side', icon: 'directions_car' },
  { id: 'mileage', label: 'Dashboard / Mileage', icon: 'speed' },
  { id: 'engine', label: 'Engine Bay', icon: 'settings' },
];

export default function InspectionWorkflowPage() {
  const navigate = useNavigate();
  const { inspections, addInspection, updateInspectionStatus, vehicleDetails } = useStore();
  const [view, setView] = useState('list'); // 'list' | 'request' | 'detail'
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadedPhotos, setUploadedPhotos] = useState({});

  const [form, setForm] = useState({
    preferredDate: '',
    preferredTime: '09:00',
    preferredLocation: '',
    vehiclePlate: vehicleDetails?.plateNumber || '',
    additionalNotes: '',
  });
  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const allInspections = inspections.length > 0 ? inspections : MOCK_INSPECTIONS;

  const handleRequestInspection = (e) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      addInspection({
        ...form,
        status: 'Requested',
        vehicle: vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : 'Your Vehicle',
        plate: form.vehiclePlate || vehicleDetails?.plateNumber || 'N/A',
        insurer: 'Pending Assignment',
        inspectorName: 'TBA',
        notes: form.additionalNotes,
        photos: {},
      });
      setSubmitting(false);
      setView('list');
    }, 1200);
  };

  const handlePhotoUpload = (slotId, e) => {
    if (e.target.files && e.target.files[0]) {
      const url = URL.createObjectURL(e.target.files[0]);
      setUploadedPhotos(prev => ({ ...prev, [slotId]: url }));
    }
  };

  if (view === 'request') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView('list')} className="p-2 hover:bg-gray-100 rounded-full"><span className="material-symbols-outlined">arrow_back</span></button>
          <h1 className="text-[24px] font-bold text-primary">Request Vehicle Inspection</h1>
        </div>

        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-5">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-blue-600 text-[18px] mt-0.5">info</span>
            <p className="text-[13px] text-blue-900">PICZ-aligned inspection required for comprehensive cover. Our certified inspectors will assess your vehicle at your preferred location.</p>
          </div>
        </div>

        <form onSubmit={handleRequestInspection} className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-[14px] border-b pb-2">Vehicle Details</h3>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Vehicle Plate Number</label>
              <input value={form.vehiclePlate} onChange={e => setField('vehiclePlate', e.target.value.toUpperCase())} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] uppercase tracking-widest font-bold focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. BAA 1234" />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-[14px] border-b pb-2">Preferred Schedule</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Date *</label>
                <input required type="date" value={form.preferredDate} min={new Date().toISOString().split('T')[0]} onChange={e => setField('preferredDate', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Time *</label>
                <div className="relative">
                  <select value={form.preferredTime} onChange={e => setField('preferredTime', e.target.value)} className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none">
                    {['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-400 pointer-events-none">expand_more</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Preferred Location *</label>
              <input required placeholder="e.g. InsurShield Office, Lusaka or your address" value={form.preferredLocation} onChange={e => setField('preferredLocation', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Additional Notes</label>
              <textarea rows={2} placeholder="Any special requirements or access notes..." value={form.additionalNotes} onChange={e => setField('additionalNotes', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none resize-none" />
            </div>
          </div>

          {/* Upload Photos in Advance (Optional) */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-bold text-[14px] border-b pb-2 mb-4">Upload Photos in Advance <span className="text-[11px] font-normal text-secondary">(Optional — speeds up inspection)</span></h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PHOTO_SLOTS.map(slot => (
                <div key={slot.id} className="border-2 border-dashed border-outline-variant rounded-xl p-3 text-center hover:border-primary/50 transition-colors">
                  {uploadedPhotos[slot.id] ? (
                    <div>
                      <img src={uploadedPhotos[slot.id]} alt={slot.label} className="h-16 object-cover rounded-lg mx-auto mb-1" />
                      <button type="button" onClick={() => setUploadedPhotos(prev => ({ ...prev, [slot.id]: null }))} className="text-[10px] text-primary font-bold">Remove</button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center gap-1">
                      <span className="material-symbols-outlined text-on-surface-variant text-2xl">{slot.icon}</span>
                      <span className="text-[11px] font-semibold text-on-surface">{slot.label}</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePhotoUpload(slot.id, e)} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button type="submit" disabled={submitting} className="w-full bg-primary text-white font-bold py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2">
            {submitting ? <><span className="material-symbols-outlined animate-spin">sync</span> Submitting...</> : <><span className="material-symbols-outlined">calendar_add_on</span> Request Inspection</>}
          </button>
        </form>
      </motion.div>
    );
  }

  if (view === 'detail' && selectedInspection) {
    const inspection = allInspections.find(i => i.id === selectedInspection.id) || selectedInspection;
    const statusInfo = INSPECTION_STATUSES.find(s => s.id === inspection.status);
    const currentIndex = INSPECTION_STATUSES.findIndex(s => s.id === inspection.status);

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView('list')} className="p-2 hover:bg-gray-100 rounded-full"><span className="material-symbols-outlined">arrow_back</span></button>
          <div>
            <h1 className="text-[22px] font-bold text-primary">Inspection {inspection.id}</h1>
            <span className={`text-[11px] font-bold px-3 py-0.5 rounded-full ${statusInfo?.color || 'bg-gray-100'}`}>{inspection.status}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <h3 className="font-bold text-[14px] uppercase tracking-wider text-on-surface-variant border-b pb-2">Inspection Details</h3>
            <div><p className="text-[11px] uppercase text-secondary font-bold">Vehicle</p><p className="font-semibold">{inspection.vehicle} ({inspection.plate})</p></div>
            <div><p className="text-[11px] uppercase text-secondary font-bold">Insurer</p><p className="font-semibold">{inspection.insurer}</p></div>
            <div><p className="text-[11px] uppercase text-secondary font-bold">Scheduled Date</p><p className="font-semibold">{new Date(inspection.scheduledDate).toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
            {inspection.inspectorName && inspection.inspectorName !== 'TBA' && (
              <>
                <div><p className="text-[11px] uppercase text-secondary font-bold">Inspector</p><p className="font-semibold">{inspection.inspectorName}</p></div>
                <div><p className="text-[11px] uppercase text-secondary font-bold">Inspector Contact</p><p className="font-semibold text-primary">{inspection.inspectorPhone}</p></div>
              </>
            )}
            <div><p className="text-[11px] uppercase text-secondary font-bold">Location</p><p className="font-semibold">{inspection.location || inspection.preferredLocation}</p></div>
          </div>

          {/* Status Progress */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-[14px] uppercase tracking-wider text-on-surface-variant border-b pb-2 mb-4">Inspection Progress</h3>
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-100" />
              <div className="space-y-3">
                {INSPECTION_STATUSES.map((status, idx) => {
                  const isDone = idx <= currentIndex;
                  const isCurrent = idx === currentIndex;
                  return (
                    <div key={status.id} className="relative flex items-center gap-3 pl-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${isDone ? 'bg-primary' : 'border-2 border-gray-200 bg-white'}`}>
                        {isDone && <span className="material-symbols-outlined text-white text-[12px]">check</span>}
                      </div>
                      <div className={`flex-1 ${isCurrent ? 'font-bold text-primary' : isDone ? 'text-on-surface' : 'text-on-surface-variant opacity-50'} text-[13px]`}>
                        {status.label}
                        {isCurrent && <span className="ml-2 text-[10px] bg-primary text-white px-2 py-0.5 rounded-full">CURRENT</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {inspection.notes && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-5">
            <p className="text-[13px] text-amber-900"><strong>Notes:</strong> {inspection.notes}</p>
          </div>
        )}

        {/* Document Upload */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-[14px] uppercase tracking-wider text-on-surface-variant border-b pb-2 mb-4">Inspection Photos</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PHOTO_SLOTS.map(slot => {
              const hasPhoto = inspection.photos?.[slot.id] || uploadedPhotos[slot.id];
              return (
                <div key={slot.id} className={`border-2 border-dashed rounded-xl p-3 text-center transition-colors ${hasPhoto ? 'border-green-400 bg-green-50' : 'border-outline-variant hover:border-primary/50'}`}>
                  {hasPhoto ? (
                    <div>
                      {uploadedPhotos[slot.id] && <img src={uploadedPhotos[slot.id]} alt={slot.label} className="h-16 object-cover rounded-lg mx-auto mb-1" />}
                      {!uploadedPhotos[slot.id] && <span className="material-symbols-outlined text-green-500 text-3xl">check_circle</span>}
                      <p className="text-[11px] font-semibold text-green-700">{slot.label}</p>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center gap-1">
                      <span className="material-symbols-outlined text-on-surface-variant text-2xl">add_photo_alternate</span>
                      <span className="text-[11px] font-semibold text-on-surface">{slot.label}</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePhotoUpload(slot.id, e)} />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-primary">Vehicle Inspections</h1>
          <p className="text-[14px] text-on-surface-variant">PICZ-aligned inspection management</p>
        </div>
        <button onClick={() => setView('request')} className="bg-primary text-white font-semibold px-5 py-2.5 rounded-xl flex items-center gap-2 hover:bg-primary-container transition-colors shadow-lg">
          <span className="material-symbols-outlined text-[18px]">add</span> Request Inspection
        </button>
      </div>

      <div className="space-y-3">
        {allInspections.map(inspection => {
          const statusInfo = INSPECTION_STATUSES.find(s => s.id === inspection.status);
          return (
            <div key={inspection.id} onClick={() => { setSelectedInspection(inspection); setView('detail'); }} className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md transition-all cursor-pointer group">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-primary">fact_check</span>
                  </div>
                  <div>
                    <p className="font-bold text-primary">{inspection.id}</p>
                    <p className="text-[13px] text-on-surface">{inspection.vehicle} ({inspection.plate})</p>
                    <p className="text-[12px] text-secondary">{inspection.insurer}</p>
                    <p className="text-[11px] text-on-surface-variant mt-1">Scheduled: {new Date(inspection.scheduledDate).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[11px] font-bold px-3 py-0.5 rounded-full ${statusInfo?.color || 'bg-gray-100'}`}>{inspection.status}</span>
                  <span className="material-symbols-outlined text-secondary group-hover:text-primary transition-colors text-[18px]">chevron_right</span>
                </div>
              </div>
            </div>
          );
        })}
        {allInspections.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <span className="material-symbols-outlined text-gray-300 text-[60px]">fact_check</span>
            <h3 className="text-[18px] font-bold text-primary mt-3">No Inspections</h3>
            <p className="text-[14px] text-on-surface-variant mt-1">Request a vehicle inspection for PICZ compliance.</p>
            <button onClick={() => setView('request')} className="mt-4 bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary-container transition-colors">Request Inspection</button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

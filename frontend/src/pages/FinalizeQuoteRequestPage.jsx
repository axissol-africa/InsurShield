import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { Input } from '../components/ui/Input';

export default function FinalizeQuoteRequestPage() {
  const navigate = useNavigate();
  const { selectedInsurers, documents, setDocument, setQuoteStatus } = useStore();
  
  // Handle empty state if users skip straight to this page during dev
  const safeInsurers = selectedInsurers || [];
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const inspectionRequired = safeInsurers.some(i => i.inspectionRules === 'Required');
  const inspectionOptional = safeInsurers.some(i => i.inspectionRules === 'Optional');

  const handleFileUpload = (type, e) => {
    if (e.target.files && e.target.files[0]) {
      const url = URL.createObjectURL(e.target.files[0]);
      setDocument(type, url);
    }
  };

  const handleSubmit = () => {
    if (!documents.whiteBook || !contactPhone) return;
    setQuoteStatus('pending');
    navigate('/waiting');
  };

  const UploadBox = ({ title, type }) => (
    <div className="border-2 border-dashed border-outline-variant rounded-xl p-6 text-center hover:border-primary/50 transition-colors relative bg-surface-container-low">
      {documents[type] ? (
        <div className="space-y-2">
          <div className="flex justify-center text-green-500">
            <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          </div>
          <p className="text-[14px] font-semibold text-on-surface">Uploaded Successfully</p>
          <img src={documents[type]} alt={title} className="mt-2 h-24 object-cover mx-auto rounded-lg shadow-sm" />
          <button className="mt-2 text-[12px] font-semibold text-primary hover:underline" onClick={() => setDocument(type, null)}>
            Retake / Re-upload
          </button>
        </div>
      ) : (
        <label className="cursor-pointer flex flex-col items-center space-y-2">
          <div className="bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center text-primary transition-transform hover:scale-110">
            <span className="material-symbols-outlined text-[24px]">photo_camera</span>
          </div>
          <span className="text-[14px] font-semibold text-on-surface">{title}</span>
          <span className="text-[12px] text-on-surface-variant">Click to capture or upload</span>
          <input 
            type="file" 
            accept="image/*" 
            capture="environment" 
            className="hidden" 
            onChange={(e) => handleFileUpload(type, e)}
          />
        </label>
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center py-12 px-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2 mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary text-3xl">task</span>
          </div>
          <h2 className="text-[24px] font-bold text-primary">Finalize Your Quote</h2>
          <p className="text-[14px] text-on-surface-variant">Upload required documents to process your quotes.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-surface-container-low">
            <h3 className="text-[16px] font-semibold text-on-surface">Required Documents</h3>
          </div>
          <div className="p-6 space-y-4">
            <UploadBox title="White Book" type="whiteBook" />
          </div>
        </div>

        {inspectionRequired && (
          <div className="bg-white rounded-2xl shadow-sm border border-accent-blue/30 overflow-hidden">
            <div className="p-4 border-b border-accent-blue/10 bg-[#e8eaf6]">
              <h3 className="text-[16px] font-semibold text-[#1a237e]">Vehicle Inspection Required</h3>
              <p className="text-[12px] text-[#3f51b5] mt-1">
                Some selected insurers require a vehicle inspection before generating a quote.
              </p>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <UploadBox title="Front View" type="insp_front" />
              <UploadBox title="Back View" type="insp_back" />
              <UploadBox title="Left Side" type="insp_left" />
              <UploadBox title="Right Side" type="insp_right" />
              <div className="col-span-2">
                <UploadBox title="Dashboard / Mileage" type="insp_mileage" />
              </div>
            </div>
          </div>
        )}

        {inspectionOptional && !inspectionRequired && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-surface-container-low">
              <h3 className="text-[16px] font-semibold text-on-surface">Optional Vehicle Inspection</h3>
              <p className="text-[12px] text-on-surface-variant mt-1">
                Inspection will be scheduled after payment, or you can upload photos now.
              </p>
            </div>
            <div className="p-6 flex gap-4">
              <button className="flex-1 py-3 border-2 border-primary text-primary font-semibold rounded-xl hover:bg-primary/5 transition-colors">
                Upload Now
              </button>
              <button className="flex-1 py-3 bg-surface-container-low text-on-surface-variant font-semibold rounded-xl hover:bg-gray-200 transition-colors">
                Skip
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-surface-container-low">
            <h3 className="text-[16px] font-semibold text-on-surface">Contact Information</h3>
            <p className="text-[12px] text-on-surface-variant mt-1">
              Where should we send your tracking link and quote updates?
            </p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (Required)</label>
              <Input 
                type="tel" 
                placeholder="e.g. 097 123 4567" 
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address (Optional)</label>
              <Input 
                type="email" 
                placeholder="e.g. your@email.com" 
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button 
            onClick={() => navigate(-1)} 
            className="flex-1 py-4 bg-surface-container-low text-on-surface-variant font-semibold rounded-xl hover:bg-gray-200 transition-colors"
          >
            Back
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={!documents.whiteBook || !contactPhone}
            className="flex-[2] py-4 bg-primary text-white font-semibold rounded-xl hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
          >
            Submit Request
          </button>
        </div>
      </motion.div>
    </div>
  );
}

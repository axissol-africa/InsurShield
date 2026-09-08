import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import { useStore } from '../store/useStore';

export default function PaymentPage() {
  const navigate = useNavigate();
  const { selectedQuote, vehicleDetails } = useStore();
  const [method, setMethod] = useState('momo');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const premiumAmount = selectedQuote ? selectedQuote.price : 2400;
  const roadTaxAmount = vehicleDetails?.includeRoadTax ? 500 : 0;
  const totalAmount = premiumAmount + roadTaxAmount;

  const handlePay = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => {
        navigate('/confirmation');
      }, 2000);
    }, 2000);
  };

  if (success) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center px-6">
        <span className="material-symbols-outlined text-green-500 text-[80px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        <h2 className="text-[32px] font-bold text-primary">Payment Successful!</h2>
        <p className="text-[16px] text-on-surface-variant">Generating your policy documents{vehicleDetails?.includeRoadTax ? ' and RTSA Road Tax disc' : ''}...</p>
      </motion.div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-80px)] flex-col items-center bg-slate-50/70 py-14 px-5 sm:px-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2 mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary text-3xl">lock</span>
          </div>
          <h2 className="text-[36px] font-extrabold tracking-[-.04em] text-on-surface">Secure Payment</h2>
          <p className="text-[16px] text-secondary">Complete your transaction to finalize the policy.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-surface-container-low p-6 border-b border-gray-100">
            <h3 className="text-[14px] font-bold uppercase tracking-wider text-on-surface-variant mb-4">Payment Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-[15px]">
                <span className="text-on-surface">Insurance Premium</span>
                <span className="font-semibold text-on-surface">ZMW {premiumAmount.toLocaleString()}</span>
              </div>
              {vehicleDetails?.includeRoadTax && (
                <div className="flex justify-between items-center text-[15px]">
                  <span className="text-on-surface">RTSA Road Tax Renewal</span>
                  <span className="font-semibold text-on-surface">ZMW {roadTaxAmount.toLocaleString()}</span>
                </div>
              )}
              <div className="pt-3 mt-3 border-t border-gray-200 flex justify-between items-center text-[18px]">
                <span className="font-bold text-on-surface">Total Amount</span>
                <span className="font-extrabold text-primary">ZMW {totalAmount.toLocaleString()}</span>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
          <div className="flex gap-3 mb-6">
            <button 
              className={cn("flex-1 min-h-12 py-3 text-[14px] font-semibold rounded-xl border-2 flex items-center justify-center gap-2 transition-all", method === 'momo' ? 'border-primary bg-white text-primary' : 'border-slate-200 text-on-surface-variant hover:text-primary')}
              onClick={() => setMethod('momo')}
            >
              <span className="material-symbols-outlined text-[18px]">smartphone</span> Mobile Money
            </button>
            <button 
              className={cn("flex-1 min-h-12 py-3 text-[14px] font-semibold rounded-xl border-2 flex items-center justify-center gap-2 transition-all", method === 'card' ? 'border-primary bg-white text-primary' : 'border-slate-200 text-on-surface-variant hover:text-primary')}
              onClick={() => setMethod('card')}
            >
              <span className="material-symbols-outlined text-[18px]">credit_card</span> Card
            </button>
          </div>

          <form onSubmit={handlePay} className="space-y-6">
            <AnimatePresence mode="wait">
              {method === 'momo' ? (
                <motion.div key="momo" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-4">
                  <div>
                    <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase block mb-2">Mobile Number</label>
                    <input className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. 0970000000" required />
                  </div>
                  <div>
                    <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase block mb-2">Network</label>
                    <div className="relative">
                      <select className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" required>
                        <option>MTN Mobile Money</option>
                        <option>Airtel Money</option>
                        <option>Zamtel Kwacha</option>
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-3 text-gray-400 pointer-events-none">expand_more</span>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="card" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
                  <div>
                    <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase block mb-2">Card Number</label>
                    <input className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" placeholder="0000 0000 0000 0000" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase block mb-2">Expiry</label>
                      <input className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" placeholder="MM/YY" required />
                    </div>
                    <div>
                      <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase block mb-2">CVV</label>
                      <input className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" placeholder="123" type="password" required />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button type="submit" className="w-full bg-primary text-white font-semibold text-[16px] py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4" disabled={loading}>
              {loading ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
                  Processing...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">lock</span>
                  Pay ZMW {totalAmount.toLocaleString()}
                </>
              )}
            </button>
          </form>
        </div>
        </div>
        
        <div className="text-center mt-6">
          <button onClick={() => navigate(-1)} className="text-primary font-semibold hover:underline text-[14px]">Back</button>
        </div>
      </motion.div>
    </div>
  );
}

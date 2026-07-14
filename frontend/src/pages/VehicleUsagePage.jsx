import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { motion } from 'framer-motion';

export default function VehicleUsagePage() {
  const navigate = useNavigate();
  const { setVehicleUsage, vehicleDetails } = useStore();

  const handleSelect = (usage) => {
    setVehicleUsage(usage);
    navigate('/quote-rules');
  };

  return (
    <div className="flex flex-col items-center py-12 px-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-primary mb-2">How do you use your vehicle?</h2>
          {vehicleDetails && (
            <p className="text-gray-500">
              For {vehicleDetails.make} {vehicleDetails.model} ({vehicleDetails.plateNumber})
            </p>
          )}
        </div>

        <div className="bg-red-50 border border-red-200 p-4 rounded-xl mb-8 flex items-start gap-3 text-left">
          <span className="material-symbols-outlined text-red-600 mt-0.5 text-[20px]">warning</span>
          <div>
            <h4 className="text-[14px] font-bold text-red-900">Important Legal Notice</h4>
            <p className="text-[12px] text-red-800 mt-1">Please select the correct primary usage of your vehicle. Choosing an incorrect category (e.g., insuring a Yango or Taxi as a standard private car) <strong>will void your policy</strong> and result in the rejection of recovery claims in the event of an accident.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { id: 'Individual', label: 'Individual', icon: 'directions_car', desc: 'Standard private car' },
            { id: 'Individual_Motorcycles', label: 'Individual (Motorcycles)', icon: 'two_wheeler', desc: 'Private motorcycle' },
            { id: 'Commercial_Motorcycles', label: 'Commercial (Motorcycles)', icon: 'moped', desc: 'Delivery or business bikes' },
            { id: 'Commercial_Cars_Hire', label: 'Commercial (Cars for Hire)', icon: 'car_rental', desc: 'Rental and leasing' },
            { id: 'Commercial_Small_Buses', label: 'Commercial (Small Public Buses)', icon: 'directions_bus', desc: 'Minibuses & Rosa' },
            { id: 'Commercial_Trucks', label: 'Commercial (Trucks, Horses & Trailers)', icon: 'local_shipping', desc: 'Heavy transport & logistics' },
            { id: 'Commercial_Taxis', label: 'Commercial (Taxis & Yangos)', icon: 'local_taxi', desc: 'Ride-hailing & traditional taxis' },
          ].map((option) => (
            <Card 
              key={option.id}
              className="cursor-pointer border-2 border-transparent hover:border-primary hover:shadow-md transition-all group"
              onClick={() => handleSelect(option.label)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-primary transition-colors">
                  <span className="material-symbols-outlined text-primary group-hover:text-white text-xl">{option.icon}</span>
                </div>
                <div>
                  <h3 className="text-[16px] font-semibold text-on-surface mb-1">{option.label}</h3>
                  <p className="text-[12px] text-on-surface-variant">{option.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

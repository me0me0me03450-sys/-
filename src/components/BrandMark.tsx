import React, { useState } from 'react';
import { GraduationCap } from 'lucide-react';

export const COMPANY_LOGO_PATH = '/assets/aistudio/IMG_2032_056245fc.jpeg';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 'md' }) => {
  const [imgError, setImgError] = useState(false);

  const boxSize =
    size === 'lg'
      ? 'h-20 w-24'
      : size === 'sm'
      ? 'h-10 w-12'
      : 'h-14 w-16';

  return (
    <div
      className={`${boxSize} relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E3E5E0] bg-white p-1 shadow-xs`}
    >
      {!imgError ? (
        <img
          src={COMPANY_LOGO_PATH}
          alt="شعار شركة تربية الأجيال الأهلية"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <GraduationCap className="h-6 w-6 text-[#0E4D3A]" aria-hidden="true" />
      )}
    </div>
  );
};

export const UnifiedFooter: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-[#E3E5E0] bg-white/70 px-4 py-5 text-center">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-1 text-xs leading-relaxed text-[#525D63]">
        <p className="font-medium text-[#11181C]">
          مهندسة النظم : موضي البديني
        </p>
        <p className="font-semibold text-[#0E4D3A]">
          شركة تربية الأجيال الأهلية
        </p>
      </div>
    </footer>
  );
};

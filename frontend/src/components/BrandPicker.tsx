import { useState, useEffect } from 'react';

export interface CardBrandItem {
  id: string;
  displayName: string;
  normalizedName: string;
}

interface Props {
  selectedBrand?: string | null;
  onSelect: (brand: string | null) => void;
  className?: string;
}

export default function BrandPicker({ selectedBrand, onSelect, className = '' }: Props) {
  const [brands, setBrands] = useState<CardBrandItem[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token') || 'dummy-token';

    fetch('/api/v1/catalog/brands', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok && Array.isArray(data.data)) {
          setBrands(data.data);
        } else {
          setBrands([
            { id: '1', displayName: 'Mastercard', normalizedName: 'mastercard' },
            { id: '2', displayName: 'Visa', normalizedName: 'visa' },
            { id: '3', displayName: 'Elo', normalizedName: 'elo' },
            { id: '4', displayName: 'Hipercard', normalizedName: 'hipercard' },
            { id: '5', displayName: 'American Express', normalizedName: 'american_express' },
            { id: '6', displayName: 'Diners Club', normalizedName: 'diners_club' },
          ]);
        }
      })
      .catch(() => {
        setBrands([
          { id: '1', displayName: 'Mastercard', normalizedName: 'mastercard' },
          { id: '2', displayName: 'Visa', normalizedName: 'visa' },
          { id: '3', displayName: 'Elo', normalizedName: 'elo' },
        ]);
      });
  }, []);

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-xs font-semibold text-texto uppercase tracking-wider">
        Bandeira do Cartão
      </label>
      <div className="grid grid-cols-3 gap-2">
        {brands.map(b => {
          const isSelected = selectedBrand?.toLowerCase() === b.displayName.toLowerCase() || selectedBrand?.toLowerCase() === b.normalizedName.toLowerCase();
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(isSelected ? null : b.displayName)}
              className={`p-2.5 rounded-lg border text-xs font-semibold text-center transition-all ${
                isSelected
                  ? 'border-verdeEquilibrio bg-verdeEquilibrio/10 text-verdeEquilibrioDark ring-1 ring-verdeEquilibrio'
                  : 'border-borda bg-superficie text-textoSecundario hover:text-texto hover:border-bordaHover hover:bg-superficieSecundaria'
              }`}
            >
              {b.displayName}
            </button>
          );
        })}
      </div>
    </div>
  );
}

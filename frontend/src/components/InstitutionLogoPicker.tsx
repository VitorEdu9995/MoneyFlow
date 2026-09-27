import { useState, useEffect, useMemo } from 'react';

export interface InstitutionItem {
  id: string;
  popularName: string;
  legalName?: string;
  bankCode?: string;
  ispb?: string;
  isFavorite?: boolean;
  logo?: {
    assetId: string;
    format: string;
    mimeType: string;
    localUrl: string;
    sourceUrl?: string;
  } | null;
}

interface Props {
  selectedInstitutionId?: string | null;
  onSelect: (institution: InstitutionItem | null) => void;
  className?: string;
}

export default function InstitutionLogoPicker({ selectedInstitutionId, onSelect, className = '' }: Props) {
  const [query, setQuery] = useState('');
  const [institutions, setInstitutions] = useState<InstitutionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    const token = localStorage.getItem('token') || 'dummy-token';

    const url = `/api/v1/catalog/institutions?query=${encodeURIComponent(query)}&limit=30`;
    fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        if (!active) return;
        if (data.ok && data.data?.institutions) {
          setInstitutions(data.data.institutions);
        } else {
          // Fallback para array vazio
          setInstitutions([]);
        }
      })
      .catch(err => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query]);

  const selectedInst = useMemo(() => {
    return institutions.find(i => i.id === selectedInstitutionId);
  }, [institutions, selectedInstitutionId]);

  const getInitials = (name: string) => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  const handleImageError = (id: string) => {
    setImgErrors(prev => ({ ...prev, [id]: true }));
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <label className="block text-sm font-medium text-textoSecundario">
        Instituição Financeira / Banco
      </label>

      {/* Input de Busca */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar banco ou instituição (ex: Nubank, Inter, Itaú)..."
          className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verdeEquilibrio"
        />
        {loading && (
          <span className="absolute right-3 top-2.5 text-xs text-gray-400">Buscando...</span>
        )}
      </div>

      {error && <p className="text-xs text-erro">{error}</p>}

      {/* Grid de Seleção */}
      <div
        role="listbox"
        aria-label="Instituições financeiras"
        className="max-h-56 overflow-y-auto space-y-1.5 p-1 border border-[#2A2A2A] rounded-lg bg-[#141414]"
      >
        {institutions.length === 0 && !loading && (
          <p className="text-xs text-center text-textoSecundario py-4">Nenhuma instituição encontrada.</p>
        )}

        {institutions.map((inst) => {
          const isSelected = inst.id === selectedInstitutionId;
          const hasImgError = imgErrors[inst.id];
          const hasLogo = inst.logo && !hasImgError;

          return (
            <button
              key={inst.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(isSelected ? null : inst)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSelected ? null : inst);
                }
              }}
              className={`w-full flex items-center justify-between p-2 rounded-md transition-colors text-left ${
                isSelected
                  ? 'bg-verdeEquilibrio/20 border border-verdeEquilibrio text-white'
                  : 'hover:bg-[#222222] text-gray-300'
              }`}
            >
              <div className="flex items-center space-x-3">
                {/* Logo ou Monograma */}
                <div className="w-8 h-8 rounded-full bg-[#262626] flex items-center justify-center overflow-hidden border border-[#3A3A3A] flex-shrink-0">
                  {hasLogo ? (
                    <img
                      src={inst.logo!.localUrl}
                      alt={`Logo ${inst.popularName}`}
                      className="w-full h-full object-contain p-0.5"
                      onError={() => handleImageError(inst.id)}
                    />
                  ) : (
                    <span className="text-xs font-semibold text-gray-300">
                      {getInitials(inst.popularName)}
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-sm font-medium">{inst.popularName}</span>
                    {inst.isFavorite && (
                      <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-1 rounded font-medium">★</span>
                    )}
                  </div>
                  {inst.ispb && (
                    <span className="text-[11px] text-gray-500">ISPB: {inst.ispb}</span>
                  )}
                </div>
              </div>

              {isSelected && (
                <span className="text-verdeEquilibrio text-sm font-bold mr-1">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';

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
    <div className={`space-y-2.5 ${className}`}>
      <label className="block text-xs font-semibold text-texto uppercase tracking-wider">
        Instituição Bancária
      </label>

      {/* Input de Busca */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar banco ou instituição (ex: Nubank, Inter, Itaú)..."
          className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto placeholder:text-textoMudo focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-sm transition-all"
        />
        {loading && (
          <span className="absolute right-3.5 top-3 text-xs text-textoSecundario font-medium">Buscando...</span>
        )}
      </div>

      {error && <p className="text-xs text-erro font-medium">{error}</p>}

      {/* Lista de Seleção */}
      <div
        role="listbox"
        aria-label="Instituições financeiras"
        className="max-h-56 overflow-y-auto space-y-1 p-1.5 border border-borda rounded-lg bg-superficie shadow-inner"
      >
        {institutions.length === 0 && !loading && (
          <p className="text-xs text-center text-textoSecundario py-5">Nenhuma instituição encontrada com este termo.</p>
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
              className={`w-full flex items-center justify-between p-2.5 rounded-lg transition-all text-left ${
                isSelected
                  ? 'bg-verdeEquilibrio/10 border border-verdeEquilibrio text-verdeEquilibrioDark font-medium'
                  : 'hover:bg-superficieSecundaria border border-transparent text-texto'
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0">
                {/* Logo ou Monograma */}
                <div className="w-8 h-8 rounded-full bg-white border border-borda flex items-center justify-center overflow-hidden flex-shrink-0 shadow-xs">
                  {hasLogo ? (
                    <img
                      src={inst.logo!.localUrl}
                      alt={`Logo ${inst.popularName}`}
                      className="w-full h-full object-contain p-1"
                      onError={() => handleImageError(inst.id)}
                    />
                  ) : (
                    <span className="text-[11px] font-bold text-azulFluxo">
                      {getInitials(inst.popularName)}
                    </span>
                  )}
                </div>

                <div className="truncate">
                  <div className="flex items-center space-x-1.5 truncate">
                    <span className="text-sm font-semibold truncate text-texto">{inst.popularName}</span>
                    {inst.isFavorite && (
                      <span className="text-xs text-atencao font-bold" title="Favorito">★</span>
                    )}
                  </div>
                  {inst.ispb && (
                    <span className="text-[11px] text-textoSecundario block">ISPB: {inst.ispb}</span>
                  )}
                </div>
              </div>

              {isSelected && (
                <span className="text-verdeEquilibrio text-sm font-bold flex-shrink-0 ml-2">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

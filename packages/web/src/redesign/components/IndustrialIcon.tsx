type IndustrialIconProps = {
  type: string;
};

export function IndustrialIcon({ type }: IndustrialIconProps) {
  const labelMap: Record<string, string> = {
    hydrocracking_reactor: 'H2',
    pdh_reactor: 'C3',
    hppo_reactor: 'PO',
    sulfur_recovery: 'S',
    hydrogen: 'H2',
    steam_header: 'HP MP LP',
  };

  if (type === 'crude_tank') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <ellipse cx="32" cy="18" rx="22" ry="9" />
        <path d="M10 18v28c0 6 10 10 22 10s22-4 22-10V18" />
        <ellipse cx="32" cy="46" rx="22" ry="9" />
        <ellipse cx="66" cy="25" rx="14" ry="6" />
        <path d="M52 25v20c0 4 6 7 14 7s14-3 14-7V25" />
      </svg>
    );
  }

  if (type === 'sphere_tank') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <circle cx="34" cy="35" r="20" />
        <circle cx="64" cy="35" r="20" />
        <path d="M14 52h70M28 55v8M70 55v8M20 34h28M50 34h28" />
      </svg>
    );
  }

  if (type === 'distillation_tower') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M18 58h20l5-48H23zM23 24h15M21 40h19" />
        <path d="M54 58h18l4-38H58zM58 34h16M56 48h18" />
        <path d="M42 54h18M12 62h72M72 58l10-14h-8" />
      </svg>
    );
  }

  if (type === 'fcc_reactor') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M24 56V18c0-6 8-10 18-10s18 4 18 10v38" />
        <path d="M54 56V26c0-5 6-9 14-9s14 4 14 9v30" />
        <path d="M24 30h36M24 44h36M54 38h28M18 60h68" />
      </svg>
    );
  }

  if (type === 'hydrocracking_reactor') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="20" y="12" width="22" height="46" rx="10" />
        <rect x="54" y="16" width="20" height="42" rx="9" />
        <path d="M42 35h12M14 62h68" />
        <text x="66" y="14">{labelMap[type]}</text>
      </svg>
    );
  }

  if (type === 'reformer') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="12" y="26" width="14" height="30" rx="6" />
        <rect x="34" y="20" width="14" height="36" rx="6" />
        <rect x="56" y="24" width="14" height="32" rx="6" />
        <rect x="78" y="28" width="10" height="28" rx="5" />
        <path d="M26 40h8M48 40h8M70 40h8M10 60h80" />
      </svg>
    );
  }

  if (type === 'gas_separation_tower') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M30 60h24l6-50H36zM34 24h22M32 40h26M18 60h64" />
        <path d="M60 20h16M60 34h16M60 48h16" />
      </svg>
    );
  }

  if (type === 'sulfur_recovery') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="20" y="28" width="48" height="28" rx="8" />
        <path d="M28 28v-9h28v9M68 40h12M14 60h70" />
        <text x="44" y="47">{labelMap[type]}</text>
      </svg>
    );
  }

  if (type === 'pdh_reactor' || type === 'hppo_reactor') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="22" y="16" width="20" height="42" rx="9" />
        <rect x="50" y="12" width="22" height="46" rx="10" />
        <path d="M42 36h8M16 62h64" />
        <text x="62" y="28">{labelMap[type]}</text>
      </svg>
    );
  }

  if (type === 'polyether_reactor') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="24" y="28" width="48" height="28" rx="14" />
        <path d="M48 12v16M34 40h28M28 62h40M42 20l12 8" />
      </svg>
    );
  }

  if (type === 'boiler') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="18" y="30" width="46" height="26" rx="8" />
        <path d="M66 18v38M26 42h28M32 24c4-8 12-8 16 0M46 18c4-8 12-8 16 0M14 62h66" />
      </svg>
    );
  }

  if (type === 'steam_header') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M16 24h64M16 38h64M16 52h64M26 16v44M48 16v44M70 16v44" />
        <text x="18" y="18">HP</text>
        <text x="42" y="18">MP</text>
        <text x="66" y="18">LP</text>
      </svg>
    );
  }

  if (type === 'cooling_tower') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M28 12h40l10 48H18zM34 30c10 8 20 8 30 0M30 46c12 8 24 8 36 0" />
        <path d="M48 62c-8-8 4-14 0-22c12 10 12 18 0 22z" />
      </svg>
    );
  }

  if (type === 'fuel_gas') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M20 52h56M28 52V30h26v22M54 40h22" />
        <path d="M68 16c12 14 15 25 4 36c-11-6-17-17-7-27c-12 7-14 18-7 27" />
      </svg>
    );
  }

  if (type === 'hydrogen') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <ellipse cx="36" cy="20" rx="20" ry="8" />
        <path d="M16 20v28c0 6 9 10 20 10s20-4 20-10V20" />
        <text x="58" y="40">{labelMap[type]}</text>
      </svg>
    );
  }

  if (type === 'substation') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <rect x="24" y="12" width="42" height="48" rx="8" />
        <path d="M52 18L36 40h13l-8 18l21-27H49zM18 62h54" />
      </svg>
    );
  }

  if (type === 'letdown_station') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <path d="M18 36h24M54 36h24M42 24l12 12l-12 12zM54 24L42 36l12 12z" />
        <circle cx="48" cy="36" r="22" />
      </svg>
    );
  }

  if (type === 'turbine_generator') {
    return (
      <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
        <circle cx="34" cy="36" r="20" />
        <path d="M22 36h24M34 24v24M54 26h24v20H54zM14 62h70" />
      </svg>
    );
  }

  return (
    <svg width="92" height="70" viewBox="0 0 96 72" aria-hidden="true">
      <rect x="22" y="18" width="52" height="36" rx="10" />
      <path d="M30 36h36M18 62h60" />
    </svg>
  );
}

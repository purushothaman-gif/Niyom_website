// Bond Pricing — staff set client/partner markups (RM proposes, admin approves).
// Prices shown to clients/partners resolve ONLY from approved rates.
//
// The screen itself is shared with unlisted shares; see MarkupPricing.

import { QueryClientProvider } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { NWEmployee } from '../types';
import { pricingQueryClient } from './pricingClient';
import { MarkupPricing } from './MarkupPricing';

export default function BondPricing({ employee }: { employee: NWEmployee }) {
  return (
    <QueryClientProvider client={pricingQueryClient}>
      <MarkupPricing
        employee={employee}
        product="bond"
        eyebrow="Bond Pricing"
        baseLabel="bond price"
        emptyIcon={Landmark}
      />
    </QueryClientProvider>
  );
}

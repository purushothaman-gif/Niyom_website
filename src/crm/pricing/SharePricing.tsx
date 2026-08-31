// Unlisted Share Pricing — staff set client/partner markups on the hand-entered
// daily share price (RM proposes, admin approves). Same workflow as bonds, over
// us_price_markup; a share with no approved rate is simply not shown to that
// client or partner.

import { QueryClientProvider } from '@tanstack/react-query';
import { Gem } from 'lucide-react';
import { NWEmployee } from '../types';
import { pricingQueryClient } from './pricingClient';
import { MarkupPricing } from './MarkupPricing';

export default function SharePricing({ employee }: { employee: NWEmployee }) {
  return (
    <QueryClientProvider client={pricingQueryClient}>
      <MarkupPricing
        employee={employee}
        product="share"
        eyebrow="Unlisted Share Pricing"
        baseLabel="share price"
        emptyIcon={Gem}
      />
    </QueryClientProvider>
  );
}

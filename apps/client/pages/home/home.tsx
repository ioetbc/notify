import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AccordionSection } from '../../components/accordion-section';
import { CampaignRow } from '../../components/campaign-row';
import { TransactionalRow } from '../../components/transactional-row';
import { TemplateRow } from '../../components/template-row';
import { NewModal } from '../../components/new-modal';
import { EmptyState } from '../../components/empty-state';
import {
  campaigns,
  transactional,
  campaignTemplates,
  transactionalTemplates,
} from '../../data/mock-data';

export function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-base font-semibold text-text-primary">Home</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/integrations"
            className="px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-row-hover rounded-md transition-colors"
          >
            Integrations
          </Link>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1.5 bg-text-primary text-white rounded-md hover:bg-gray-800 transition-colors text-sm font-medium cursor-pointer"
          >
            New
          </button>
        </div>
      </div>

      <div className="flex flex-col">
        {/* Filter row with column headers */}
        <div className="grid grid-cols-[1fr_6rem_5rem_5rem_5rem_5rem] items-center h-9 px-3 text-sm text-text-secondary bg-row-hover rounded-md">
          <div className="flex items-center gap-2">
            <span>▼</span>
            <span>Filter</span>
          </div>
          <div className="flex items-center gap-1">
            <span>▽</span>
            <span>Updated</span>
          </div>
          <div className="text-right">Sends</div>
          <div className="text-right">Opens</div>
          <div className="text-right">Clicks</div>
          <div className="text-right">Status</div>
        </div>

        {/* Campaigns Section */}
        <AccordionSection
          title="Campaigns"
          count={campaigns.length}
          storageKey="accordion-campaigns"
        >
          {campaigns.length > 0 ? (
            campaigns.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))
          ) : (
            <EmptyState
              message="No campaigns yet"
              onCreateClick={() => setIsModalOpen(true)}
            />
          )}
        </AccordionSection>

        {/* Transactional Section */}
        <AccordionSection
          title="Transactional"
          count={transactional.length}
          storageKey="accordion-transactional"
        >
          {transactional.length > 0 ? (
            transactional.map((item) => (
              <TransactionalRow key={item.id} transactional={item} />
            ))
          ) : (
            <EmptyState
              message="No transactional notifications yet"
              onCreateClick={() => setIsModalOpen(true)}
            />
          )}
        </AccordionSection>

        {/* Campaign Templates Section */}
        <AccordionSection
          title="Campaign Templates"
          count={campaignTemplates.length}
          storageKey="accordion-campaign-templates"
        >
          {campaignTemplates.map((template) => (
            <TemplateRow key={template.id} template={template} />
          ))}
        </AccordionSection>

        {/* Transactional Templates Section */}
        <AccordionSection
          title="Transactional Templates"
          count={transactionalTemplates.length}
          storageKey="accordion-transactional-templates"
        >
          {transactionalTemplates.map((template) => (
            <TemplateRow key={template.id} template={template} />
          ))}
        </AccordionSection>
      </div>

      <NewModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/api';
import { Layout } from './components/layout';
import { Home } from './pages/home';
import { CampaignDetail } from './pages/campaign-detail';
import { TransactionalDetail } from './pages/transactional-detail';
import { NewCampaign } from './pages/new-campaign';
import { NewTransactional } from './pages/new-transactional';
import { NewLoop } from './pages/new-loop';
import { NewWorkflowPage, EditWorkflowPage } from './pages/workflow';
import { NewCanvas2Page, EditCanvas2Page } from './pages/canvas2';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/campaigns/new" element={<NewCampaign />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/transactional/new" element={<NewTransactional />} />
            <Route path="/transactional/:id" element={<TransactionalDetail />} />
            <Route path="/loops/new" element={<NewLoop />} />
            <Route path="/workflow" element={<NewWorkflowPage />} />
            <Route path="/workflow/:id" element={<EditWorkflowPage />} />
            <Route path="/canvas2" element={<NewCanvas2Page />} />
            <Route path="/canvas2/:id" element={<EditCanvas2Page />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

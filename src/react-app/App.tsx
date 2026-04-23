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
import { WorkflowPage } from './pages/workflow';
import { Canvas } from './pages/canvas';

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
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/canvas" element={<Canvas />} />
            <Route path="/canvas/:id" element={<Canvas />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

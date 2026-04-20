import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Landing } from "@/pages/Landing";
import { AppHome } from "@/pages/AppHome";
import { NewProject } from "@/pages/NewProject";
import { ProjectHome } from "@/pages/ProjectHome";
import { ProjectSettings } from "@/pages/ProjectSettings";
import { ProjectSetup } from "@/pages/ProjectSetup";
import { ProjectReleases } from "@/pages/ProjectReleases";
import { GroupDetail } from "@/pages/GroupDetail";
import { NewOrg } from "@/pages/NewOrg";
import { OrgSettings } from "@/pages/OrgSettings";
import { PublicDashboard } from "@/pages/PublicDashboard";
import { Docs } from "@/pages/Docs";
import { ErrorPage } from "@/pages/ErrorPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<AppHome />} />
            <Route path="/app/new" element={<NewProject />} />
            <Route path="/app/:slug" element={<ProjectHome />} />
            <Route path="/app/:slug/setup" element={<ProjectSetup />} />
            <Route path="/app/:slug/settings" element={<ProjectSettings />} />
            <Route path="/app/:slug/releases" element={<ProjectReleases />} />
            <Route path="/app/:slug/groups/:id" element={<GroupDetail />} />
            <Route path="/app/orgs/new" element={<NewOrg />} />
            <Route path="/app/orgs/:slug" element={<OrgSettings />} />
            <Route path="/p/:slug" element={<PublicDashboard />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/401" element={<ErrorPage status={401} />} />
            <Route path="/403" element={<ErrorPage status={403} />} />
            <Route path="/429" element={<ErrorPage status={429} />} />
            <Route path="/500" element={<ErrorPage status={500} />} />
            <Route path="*" element={<ErrorPage status={404} />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

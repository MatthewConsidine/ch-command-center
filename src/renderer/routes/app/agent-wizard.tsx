import { createFileRoute } from '@tanstack/react-router'

import { AgentWizardPage } from '@renderer/pages/agentWizard/AgentWizardPage'

export const Route = createFileRoute('/app/agent-wizard')({
  component: AgentWizardPage
})

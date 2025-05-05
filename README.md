# Plan App by Paul Le (Luapxanna)

A planning and tracking application built with Encore.dev, featuring workspace, lead, application, and offer management, insights, and audit logging.

## Service Summary

The application consists of several interconnected services:

1. **Authentication & Authorization**
   - User authentication via Logto OAuth
   - Role-based access control (RBAC)
   - Permission management (read:insight, write:insight)
   - Workspace context management
   - Email verification
   - Session management

2. **Workspace Management**
   - Create and manage workspaces
   - User workspace access control
   - Workspace context switching
   - Multi-tenant support

3. **Plan Management**
   - Create, read, update, and delete plans
   - Plan categorization
   - Plan status tracking
   - Plan assignment to applications

4. **Lead Management**
   - Lead creation and tracking
   - Lead status management
   - Lead assignment
   - Lead conversion to customers
   - SQS integration for lead processing

5. **Application Management**
   - Application lifecycle management
   - Status tracking (pending, reviewing, approved, rejected)
   - Application notes and comments
   - Plan association

6. **Offer Management**
   - Offer creation and management
   - Package customization
   - Status tracking (draft, sent, accepted, rejected, expired)
   - Offer notes and history

7. **Quote Management**
   - Quote generation
   - Quote tracking and analytics
   - Status management (draft, sent, viewed, accepted, rejected, expired)
   - Quote history and statistics

8. **Insights Service**
   - Create and list insights within workspaces
   - Real-time event emission for new insights
   - Comprehensive audit logging
   - Row-level security for data access

9. **Analytics & Reporting**
   - Quote statistics and analytics
   - Lead conversion tracking
   - Application success rates
   - User activity monitoring

10. **Audit Logging**
    - Track all user actions
    - Record resource changes
    - Maintain action history with details
    - Workspace-scoped logging

## Scope & RLS Logic

### Data Access Control

The application implements Row-Level Security (RLS) across all tables:

1. **Users**
   - Users can only access their own data
   - Superusers have access to all data
   - Email lookup allowed during login

2. **Workspaces**
   - Access granted to workspace members
   - Superusers have access to all workspaces
   - Workspace context required for operations

3. **Plans**
   - Access limited to workspace members
   - Superusers can access all plans
   - Plans are workspace-scoped

4. **Leads**
   - Access limited to workspace members
   - Superusers can access all leads
   - Leads are workspace-scoped

5. **Applications**
   - Access limited to workspace members
   - Superusers can access all applications
   - Applications are workspace-scoped

6. **Offers**
   - Access limited to workspace members
   - Superusers can access all offers
   - Offers are workspace-scoped

7. **Quotes**
   - Access limited to workspace members
   - Superusers can access all quotes
   - Quotes are workspace-scoped

8. **Audit Log**
   - Users can only see their own audit logs
   - Superusers can see all audit logs
   - Logs are workspace-scoped

### Permission System

- Uses Logto's built-in permission system
- Permissions are role-based (e.g., admin, user)
- Key permissions:
  - `read:insight` - View insights
  - `write:insight` - Create insights
- Also used Logto customdata for and check customdata for permissions.
## Event Emission

The application uses Encore's pub/sub system for real-time event handling:

1. **New Insight Events**
   - Emitted when an insight is created
   - Uses "at-least-once" delivery guarantee
   - Includes deduplication to prevent double-processing
   - Triggers audit logging

2. **Lead Processing Events**
   - SQS integration for lead processing
   - Asynchronous lead handling
   - Event tracking and monitoring

3. **Event Flow**
   ```
   Create Insight -> Publish Event -> Subscription Handler -> Audit Log
   Lead Creation -> SQS Queue -> Lead Worker -> Lead Processing
   ```

4. **Event Data**
   - Includes resource details
   - Contains workspace and user context
   - Maintains data consistency

## Potential Improvements (v2)

   - Generate usage reports
   - Full-text search/filter
   - Optimize database queries
   - Add two-factor authentication (Already have one email verification with signing up to Logto)

## API Endpoints

### Authentication & Authorization
- `GET /auth/login` - Initiate login flow with Logto
- `GET /auth/callback` - Handle OAuth callback from Logto
- `POST /auth/logout` - Logout current user
- `GET /auth/current-user` - Get current user details
- `GET /auth/current-token` - Get current authentication token

### Workspace Management
- `POST /workspace` - Create a new workspace
- `GET /workspace` - List all workspaces for current user
- `GET /workspace/current` - Get current workspace context
- `POST /workspace/switch` - Switch current workspace context

### Plan Management
- `POST /plan` - Create a new plan
  - Body: `{ name: string }`
- `GET /plan/:id` - Get plan by ID
- `PUT /plan/:id` - Update plan
  - Body: `{ name: string }`
- `DELETE /plan/:id` - Delete plan

### Lead Management
- `POST /lead` - Create a new lead
  - Body: `{ name: string, email: string, phone?: string, details?: any }`
- `GET /lead/:id` - Get lead by ID
- `GET /lead` - List all leads in current workspace
- `PUT /lead/:id` - Update lead
  - Body: `{ name?: string, email?: string, phone?: string, details?: any }`
- `DELETE /lead/:id` - Delete lead

### Application Management
- `POST /application` - Create a new application
  - Body: `{ lead_id: string, plan_id: string }`
- `GET /application/:id` - Get application by ID
- `GET /application` - List all applications in current workspace
- `DELETE /application/:id` - Delete application
- `PUT /application/:id/status` - Update application status
  - Body: `{ status: 'pending' | 'reviewing' | 'approved' | 'rejected', notes?: string }`

### Offer Management
- `POST /offer` - Create a new offer
  - Body: `{ application_id: string, package_details: any }`
- `GET /offer/:id` - Get offer by ID
- `GET /offer` - List all offers in current workspace
- `PUT /offer/:id/status` - Update offer status
  - Body: `{ status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired', notes?: string }`

### Quote Management
- `POST /quote` - Create a new quote
  - Body: `{ application_id: string, amount: number, details?: any }`
- `GET /quote/:id` - Get quote by ID
- `GET /quote` - List all quotes in current workspace
- `PUT /quote/:id/status` - Update quote status
  - Body: `{ status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired', notes?: string }`

### Analytics & Statistics
- `GET /stats/quotes` - Get quote statistics for a workspace
  - Query: `{ workspace_id: string }`
- `GET /stats/lead-quotes` - Get quote history for a lead
  - Query: `{ lead_id: string }`

### Insights Service
- `POST /insight` - Create a new insight
  - Required permissions: `write:insight`
  - Body: `{ title: string, content: string }`
- `GET /insight` - List all insights in current workspace
  - Required permissions: `read:insight`
  - Returns: `{ insights: Insight[] }`

### Audit Logging
- `GET /audit-log` - List all audit logs for current workspace
  - Required permissions: `read:insight`
  - Returns: `{ logs: AuditLog[] }`

### Event Topics
- `insight-new` - Published when a new insight is created
  - Delivery guarantee: "at-least-once"
  - Triggers audit logging


## Running the Application

1. Start the development server:
```bash
encore run
```

2. Access the API at `http://localhost:4000` or `http://localhost:9400`



# Project access in Every App mode

In `AUTH_MODE=everyapp`, owners and admins can see and use every project in the workspace. Members can see and use only projects with a `project_members` row for their user ID. A member with no assignments sees no projects. Other authentication modes keep their existing access rules.

The Gateway's signed identity supplies the role and user ID. OpenSEO does not accept a role from request parameters or trust a mirrored organization membership to authorize an Every App caller. An unassigned project returns the same result as a project in another organization at each entry point.

Owners and admins manage explicit grants in Project settings → Project access, or through `list_project_members`, `add_project_member`, and `remove_project_member`. Adding uses the email of a local user who has already opened OpenSEO through the Gateway. Removing a grant leaves the person's Gateway organization membership intact. Owners and admins need no grant; removing their explicit grant does not remove their access.

Members cannot create projects. This uses the existing project creation permission instead of automatically granting a creator access. Automatic grants would let a member create projects outside the owner's chosen assignments.

A shared project lookup and listing predicate applies the membership rule. Server functions, MCP tools, report documents, exports, map requests, and SAM connection authorization use it. Report map grants bind to a project in Every App mode. SAM retains the verified role from connection authorization and rechecks project access on later turns. A role change takes effect on the next authorized connection or HTTP request; project grant removal takes effect on subsequent project checks. Workflows and scheduled organization work remain independent of user grants.

An explicit join table keeps grants separate from Gateway organization roles. Reusing organization membership alone would preserve workspace-wide access; storing project IDs in a user JSON field would obscure relationships and prevent foreign-key cleanup.

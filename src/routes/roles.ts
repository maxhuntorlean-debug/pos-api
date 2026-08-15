import { Hono } from 'hono'

import { authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'

type Bindings = {
  DB: D1Database
}

type Variables = {
  user: {
    id: number
    name: string
    username: string
    role: string
  }
}

const roles = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================
// GET ROLES
// ======================================

roles.get(
  '/',
  authMiddleware,
  requirePermission('roles.read'),
  async (c) => {
    const result = await c.env.DB
      .prepare(`
        SELECT
          id,
          code,
          name,
          active,
          created_at
        FROM roles
        ORDER BY id
      `)
      .all()

    return c.json({
      ok: true,
      roles: result.results
    })
  }
)


// ======================================
// CREATE ROLE
// ======================================

roles.post(
  '/',
  authMiddleware,
  requirePermission('roles.update'),
  async (c) => {
    const body = await c.req.json<{
      code: string
      name: string
      active?: boolean
    }>()

    const code = String(body.code ?? '')
      .trim()
      .toLowerCase()

    const name = String(body.name ?? '').trim()

    const active =
      body.active === undefined
        ? true
        : body.active

    if (!code || !name) {
      return c.json(
        {
          ok: false,
          error: 'code and name are required'
        },
        400
      )
    }

    if (typeof active !== 'boolean') {
      return c.json(
        {
          ok: false,
          error: 'active must be boolean'
        },
        400
      )
    }

    if (!/^[a-z0-9._-]+$/.test(code)) {
      return c.json(
        {
          ok: false,
          error: 'Invalid role code'
        },
        400
      )
    }

    const existing = await c.env.DB
      .prepare(`
        SELECT id
        FROM roles
        WHERE code = ?
        LIMIT 1
      `)
      .bind(code)
      .first()

    if (existing) {
      return c.json(
        {
          ok: false,
          error: 'Role already exists'
        },
        409
      )
    }

    const result = await c.env.DB
      .prepare(`
        INSERT INTO roles (
          code,
          name,
          active
        )
        VALUES (?, ?, ?)
      `)
      .bind(
        code,
        name,
        active ? 1 : 0
      )
      .run()

    return c.json(
      {
        ok: true,
        role: {
          id: result.meta.last_row_id,
          code,
          name,
          active
        }
      },
      201
    )
  }
)


// ======================================
// UPDATE ROLE
// ======================================

roles.put(
  '/:id',
  authMiddleware,
  requirePermission('roles.update'),
  async (c) => {
    const roleId = Number(c.req.param('id'))

    if (!Number.isInteger(roleId) || roleId <= 0) {
      return c.json(
        {
          ok: false,
          error: 'Invalid role id'
        },
        400
      )
    }

    const existingRole = await c.env.DB
      .prepare(`
        SELECT
          id,
          code,
          name,
          active
        FROM roles
        WHERE id = ?
        LIMIT 1
      `)
      .bind(roleId)
      .first<{
        id: number
        code: string
        name: string
        active: number
      }>()

    if (!existingRole) {
      return c.json(
        {
          ok: false,
          error: 'Role not found'
        },
        404
      )
    }

    const body = await c.req.json<{
      code: string
      name: string
      active: boolean
    }>()

    const code = String(body.code ?? '')
      .trim()
      .toLowerCase()

    const name = String(body.name ?? '').trim()

    if (!code || !name) {
      return c.json(
        {
          ok: false,
          error: 'code and name are required'
        },
        400
      )
    }

    if (typeof body.active !== 'boolean') {
      return c.json(
        {
          ok: false,
          error: 'active must be boolean'
        },
        400
      )
    }

    if (!/^[a-z0-9._-]+$/.test(code)) {
      return c.json(
        {
          ok: false,
          error: 'Invalid role code'
        },
        400
      )
    }

    // Системную роль admin не переименовываем
    // и не отключаем.
    if (existingRole.code === 'admin') {
      if (code !== 'admin') {
        return c.json(
          {
            ok: false,
            error: 'Admin role code cannot be changed'
          },
          400
        )
      }

      if (!body.active) {
        return c.json(
          {
            ok: false,
            error: 'Admin role cannot be disabled'
          },
          400
        )
      }
    }

    const duplicate = await c.env.DB
      .prepare(`
        SELECT id
        FROM roles
        WHERE code = ?
          AND id != ?
        LIMIT 1
      `)
      .bind(
        code,
        roleId
      )
      .first()

    if (duplicate) {
      return c.json(
        {
          ok: false,
          error: 'Role code already exists'
        },
        409
      )
    }

    await c.env.DB
      .prepare(`
        UPDATE roles
        SET
          code = ?,
          name = ?,
          active = ?
        WHERE id = ?
      `)
      .bind(
        code,
        name,
        body.active ? 1 : 0,
        roleId
      )
      .run()

    return c.json({
      ok: true,
      role: {
        id: roleId,
        code,
        name,
        active: body.active
      }
    })
  }
)


// ======================================
// GET PERMISSIONS
// ======================================

roles.get(
  '/permissions',
  authMiddleware,
  requirePermission('permissions.read'),
  async (c) => {
    const result = await c.env.DB
      .prepare(`
        SELECT
          id,
          code,
          name,
          group_name,
          created_at
        FROM permissions
        ORDER BY
          group_name,
          name
      `)
      .all()

    return c.json({
      ok: true,
      permissions: result.results
    })
  }
)


// ======================================
// CREATE PERMISSION
// ======================================

roles.post(
  '/permissions',
  authMiddleware,
  requirePermission('permissions.update'),
  async (c) => {
    const body = await c.req.json<{
      code: string
      name: string
      groupName: string
    }>()

    const code = String(body.code ?? '')
      .trim()
      .toLowerCase()

    const name = String(body.name ?? '').trim()

    const groupName = String(body.groupName ?? '')
      .trim()
      .toLowerCase()

    if (!code || !name || !groupName) {
      return c.json(
        {
          ok: false,
          error: 'code, name and groupName are required'
        },
        400
      )
    }

    if (!/^[a-z0-9._-]+$/.test(code)) {
      return c.json(
        {
          ok: false,
          error: 'Invalid permission code'
        },
        400
      )
    }

    if (!/^[a-z0-9._-]+$/.test(groupName)) {
      return c.json(
        {
          ok: false,
          error: 'Invalid permission group'
        },
        400
      )
    }

    const existing = await c.env.DB
      .prepare(`
        SELECT id
        FROM permissions
        WHERE code = ?
        LIMIT 1
      `)
      .bind(code)
      .first()

    if (existing) {
      return c.json(
        {
          ok: false,
          error: 'Permission already exists'
        },
        409
      )
    }

    const result = await c.env.DB
      .prepare(`
        INSERT INTO permissions (
          code,
          name,
          group_name
        )
        VALUES (?, ?, ?)
      `)
      .bind(
        code,
        name,
        groupName
      )
      .run()

    return c.json(
      {
        ok: true,
        permission: {
          id: result.meta.last_row_id,
          code,
          name,
          groupName
        }
      },
      201
    )
  }
)


// ======================================
// UPDATE PERMISSION
// ======================================

roles.put(
  '/permissions/:id',
  authMiddleware,
  requirePermission('permissions.update'),
  async (c) => {
    const permissionId = Number(c.req.param('id'))

    if (
      !Number.isInteger(permissionId) ||
      permissionId <= 0
    ) {
      return c.json(
        {
          ok: false,
          error: 'Invalid permission id'
        },
        400
      )
    }

    const permission = await c.env.DB
      .prepare(`
        SELECT
          id,
          code
        FROM permissions
        WHERE id = ?
        LIMIT 1
      `)
      .bind(permissionId)
      .first<{
        id: number
        code: string
      }>()

    if (!permission) {
      return c.json(
        {
          ok: false,
          error: 'Permission not found'
        },
        404
      )
    }

    const body = await c.req.json<{
      code: string
      name: string
      groupName: string
    }>()

    const code = String(body.code ?? '')
      .trim()
      .toLowerCase()

    const name = String(body.name ?? '').trim()

    const groupName = String(body.groupName ?? '')
      .trim()
      .toLowerCase()

    if (!code || !name || !groupName) {
      return c.json(
        {
          ok: false,
          error: 'code, name and groupName are required'
        },
        400
      )
    }

    if (!/^[a-z0-9._-]+$/.test(code)) {
      return c.json(
        {
          ok: false,
          error: 'Invalid permission code'
        },
        400
      )
    }

    if (!/^[a-z0-9._-]+$/.test(groupName)) {
      return c.json(
        {
          ok: false,
          error: 'Invalid permission group'
        },
        400
      )
    }

    // Системное право admin.access
    // не переименовываем.
    if (
      permission.code === 'admin.access' &&
      code !== 'admin.access'
    ) {
      return c.json(
        {
          ok: false,
          error: 'admin.access code cannot be changed'
        },
        400
      )
    }

    const duplicate = await c.env.DB
      .prepare(`
        SELECT id
        FROM permissions
        WHERE code = ?
          AND id != ?
        LIMIT 1
      `)
      .bind(
        code,
        permissionId
      )
      .first()

    if (duplicate) {
      return c.json(
        {
          ok: false,
          error: 'Permission code already exists'
        },
        409
      )
    }

    await c.env.DB
      .prepare(`
        UPDATE permissions
        SET
          code = ?,
          name = ?,
          group_name = ?
        WHERE id = ?
      `)
      .bind(
        code,
        name,
        groupName,
        permissionId
      )
      .run()

    return c.json({
      ok: true,
      permission: {
        id: permissionId,
        code,
        name,
        groupName
      }
    })
  }
)


// ======================================
// GET ROLE PERMISSIONS
// ======================================

roles.get(
  '/:id/permissions',
  authMiddleware,
  requirePermission('roles.read'),
  async (c) => {
    const roleId = Number(c.req.param('id'))

    if (!Number.isInteger(roleId) || roleId <= 0) {
      return c.json(
        {
          ok: false,
          error: 'Invalid role id'
        },
        400
      )
    }

    const role = await c.env.DB
      .prepare(`
        SELECT
          id,
          code,
          name,
          active
        FROM roles
        WHERE id = ?
        LIMIT 1
      `)
      .bind(roleId)
      .first()

    if (!role) {
      return c.json(
        {
          ok: false,
          error: 'Role not found'
        },
        404
      )
    }

    const result = await c.env.DB
      .prepare(`
        SELECT
          permissions.id,
          permissions.code,
          permissions.name,
          permissions.group_name
        FROM role_permissions

        JOIN permissions
          ON permissions.id =
             role_permissions.permission_id

        WHERE role_permissions.role_id = ?

        ORDER BY
          permissions.group_name,
          permissions.name
      `)
      .bind(roleId)
      .all()

    return c.json({
      ok: true,
      role,
      permissions: result.results
    })
  }
)


// ======================================
// UPDATE ROLE PERMISSIONS
// ======================================

roles.put(
  '/:id/permissions',
  authMiddleware,
  requirePermission('roles.update'),
  async (c) => {
    const roleId = Number(c.req.param('id'))

    if (!Number.isInteger(roleId) || roleId <= 0) {
      return c.json(
        {
          ok: false,
          error: 'Invalid role id'
        },
        400
      )
    }

    const role = await c.env.DB
      .prepare(`
        SELECT
          id,
          code,
          name
        FROM roles
        WHERE id = ?
        LIMIT 1
      `)
      .bind(roleId)
      .first<{
        id: number
        code: string
        name: string
      }>()

    if (!role) {
      return c.json(
        {
          ok: false,
          error: 'Role not found'
        },
        404
      )
    }

    const body = await c.req.json<{
      permissionIds: number[]
    }>()

    if (!Array.isArray(body.permissionIds)) {
      return c.json(
        {
          ok: false,
          error: 'permissionIds is required'
        },
        400
      )
    }

    const permissionIds = [
      ...new Set(
        body.permissionIds
          .map(Number)
          .filter(
            (id) =>
              Number.isInteger(id) &&
              id > 0
          )
      )
    ]

    const allPermissions = await c.env.DB
      .prepare(`
        SELECT
          id,
          code
        FROM permissions
      `)
      .all<{
        id: number
        code: string
      }>()

    const validIds = new Set(
      allPermissions.results.map(
        (permission) => permission.id
      )
    )

    const invalidIds = permissionIds.filter(
      (id) => !validIds.has(id)
    )

    if (invalidIds.length > 0) {
      return c.json(
        {
          ok: false,
          error: 'Invalid permission id',
          invalidIds
        },
        400
      )
    }

    // Для admin всегда оставляем admin.access.
    if (role.code === 'admin') {
      const adminAccess =
        allPermissions.results.find(
          (permission) =>
            permission.code === 'admin.access'
        )

      if (
        adminAccess &&
        !permissionIds.includes(adminAccess.id)
      ) {
        return c.json(
          {
            ok: false,
            error:
              'admin.access cannot be removed from admin role'
          },
          400
        )
      }
    }

    const statements: D1PreparedStatement[] = [
      c.env.DB
        .prepare(`
          DELETE FROM role_permissions
          WHERE role_id = ?
        `)
        .bind(roleId)
    ]

    for (const permissionId of permissionIds) {
      statements.push(
        c.env.DB
          .prepare(`
            INSERT INTO role_permissions (
              role_id,
              permission_id
            )
            VALUES (?, ?)
          `)
          .bind(
            roleId,
            permissionId
          )
      )
    }

    await c.env.DB.batch(statements)

    return c.json({
      ok: true,
      roleId,
      permissionIds
    })
  }
)

export default roles
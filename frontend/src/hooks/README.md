# TanStack Query Hooks

This directory contains custom hooks that use TanStack Query (React Query) for data fetching, caching, and state management.

## Available Hooks

- `useAuthQuery`: Authentication-related queries and mutations
- `useAdminQuery`: Admin-related queries and mutations
- `useTeacherQuery`: Teacher-related queries and mutations
- `useStudentQuery`: Student-related queries and mutations
- `useDepartmentQuery`: Department-related queries and mutations
- `useCourseQuery`: Course-related queries and mutations
- `useConversationQuery`: Conversation-related queries and mutations
- `useNewsQuery`: News-related queries and mutations

## Usage Examples

### Authentication

```tsx
import { useAuthQuery } from '@hooks';
import { useState } from 'react';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { teacherLoginMutation } = useAuthQuery();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await teacherLoginMutation.mutateAsync({ email, password });
      // Handle successful login
    } catch (error) {
      // Handle error
    }
  };

  return (
    <form onSubmit={handleLogin}>
      {/* Form fields */}
      <button 
        type="submit" 
        disabled={teacherLoginMutation.isPending}
      >
        {teacherLoginMutation.isPending ? 'Logging in...' : 'Login'}
      </button>
      {teacherLoginMutation.isError && (
        <div className="error">
          {teacherLoginMutation.error?.message || 'Login failed'}
        </div>
      )}
    </form>
  );
};
```

### Fetching Data

```tsx
import { useDepartmentQuery } from '@hooks';
import { useState } from 'react';

const DepartmentsPage = () => {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  
  const { getAllDepartmentsQuery } = useDepartmentQuery();
  const { data, isLoading, isError, error } = getAllDepartmentsQuery({ 
    page, 
    limit, 
    search 
  });

  if (isLoading) return <div>Loading...</div>;
  if (isError) return <div>Error: {error?.message}</div>;

  return (
    <div>
      <h1>Departments</h1>
      <input 
        type="text" 
        value={search} 
        onChange={(e) => setSearch(e.target.value)} 
        placeholder="Search departments..." 
      />
      <ul>
        {data?.data?.data?.items.map((department) => (
          <li key={department.id}>{department.name}</li>
        ))}
      </ul>
      <div className="pagination">
        <button 
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button 
          onClick={() => setPage(p => p + 1)}
          disabled={!data?.data?.data?.hasMore}
        >
          Next
        </button>
      </div>
    </div>
  );
};
```

### Creating Data

```tsx
import { useTeacherQuery } from '@hooks';
import { useState } from 'react';

const CreateCoursePage = () => {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    duration: '',
    departmentId: '',
  });
  
  const { createCourseMutation } = useTeacherQuery();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createCourseMutation.mutateAsync(formData);
      // Handle success
    } catch (error) {
      // Handle error
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
      <button 
        type="submit" 
        disabled={createCourseMutation.isPending}
      >
        {createCourseMutation.isPending ? 'Creating...' : 'Create Course'}
      </button>
    </form>
  );
};
```

## Benefits of Using TanStack Query

- **Automatic Caching**: Data is cached and reused when needed
- **Automatic Refetching**: Data is automatically refetched when needed
- **Loading & Error States**: Easy access to loading and error states
- **Pagination & Infinite Scroll**: Built-in support for pagination
- **Prefetching**: Prefetch data before it's needed
- **Mutations**: Easily update server state
- **Optimistic Updates**: Update UI before server responds
- **Automatic Garbage Collection**: Unused data is automatically removed
- **Devtools**: Built-in devtools for debugging

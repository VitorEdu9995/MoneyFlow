export const apiExecute = async (tool: string, args: any) => {
  const token = localStorage.getItem('token') || 'dummy-token';
  const response = await fetch('/api/v1/mcp/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ tool, args })
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Erro na API');
  }
  return data.data;
};

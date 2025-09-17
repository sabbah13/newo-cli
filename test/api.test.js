/**
 * Unit tests for API functions
 */
import assert from 'assert';
import { makeClient, listProjects, listAgents, getProjectMeta } from '../dist/api.js';

describe('API Functions', function() {
  this.timeout(10000); // Set longer timeout for API calls

  let client;

  before(async function() {
    client = await makeClient();
  });

  describe('Authentication', function() {
    it('should create client with valid access token', async function() {
      assert(client, 'Client should be created');
      assert(client.defaults, 'Client should have defaults');
      assert(client.defaults.baseURL, 'Client should have base URL configured');
    });
  });

  describe('Projects API', function() {
    it('should list all projects', async function() {
      const projects = await listProjects(client);
      assert(Array.isArray(projects), 'Projects should be an array');
      assert(projects.length > 0, 'Should have at least one project');
      
      const project = projects[0];
      assert(project.id, 'Project should have id');
      assert(project.idn, 'Project should have idn');
      assert(project.title, 'Project should have title');
    });

    it('should get specific project metadata', async function() {
      const projects = await listProjects(client);
      const projectId = projects[0].id;
      
      const meta = await getProjectMeta(client, projectId);
      assert(meta.id === projectId, 'Should return correct project');
      assert(meta.idn, 'Should have project idn');
      assert(meta.title, 'Should have project title');
    });
  });

  describe('Agents API', function() {
    it('should list agents for a project', async function() {
      const projects = await listProjects(client);
      const projectId = projects[0].id;
      
      const agents = await listAgents(client, projectId);
      assert(Array.isArray(agents), 'Agents should be an array');
      
      if (agents.length > 0) {
        const agent = agents[0];
        assert(agent.id, 'Agent should have id');
        assert(agent.idn, 'Agent should have idn');
        assert(Array.isArray(agent.flows), 'Agent should have flows array');
      }
    });
  });
});
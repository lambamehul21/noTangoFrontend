"use client"
import { useRef, useEffect, useState } from 'react'
import grapesjs from 'grapesjs'
import "grapesjs/dist/css/grapes.min.css"
import "./styles.css" // Import the separated CSS file
import axios from 'axios'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faSave,
  faFileExport,
  faLayerGroup,
  faPencilAlt,
  faDatabase,
  faTextWidth,
  faHeading,
  faImage,
  faSquare,
  faArrowUp,
  faWindowMaximize
} from '@fortawesome/free-solid-svg-icons'

interface XmlRecord {
  id: string,
  path: string,
  value: string
}

interface TreeNode {
  key: string,
  label: string,
  path: string,
  value: string | null,
  children: TreeNode[],
  isLeaf: boolean,
  isExpanded?: boolean
}

interface EditorInstance {
  id: string;
  editor: any;
  containerEl: HTMLElement;
  parentFrameId?: string;
  autoSaveInterval?: NodeJS.Timeout;
}

const EditorGrapes = () => {
  const editorRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState('properties');
  const selectedComponentRef = useRef<any>(null);
  const styleManagerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const [xmlCode, setXmlCode] = useState<string>('');
  const [showXmlExport, setShowXmlExport] = useState<boolean>(false);
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [isLoadingTables, setIsLoadingTables] = useState<boolean>(false);
  const [records, setRecords] = useState<XmlRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState<boolean>(false);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  
  // New state for nested editing
  const [editorInstances, setEditorInstances] = useState<EditorInstance[]>([]);
  const [activeEditorIndex, setActiveEditorIndex] = useState<number>(0);
  const [showNestedEditor, setShowNestedEditor] = useState<boolean>(false);
  const [editorBreadcrumbs, setEditorBreadcrumbs] = useState<string[]>(['Main Editor']);
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);

  const buildTree = (records: XmlRecord[]): TreeNode[] => {
    const root: TreeNode = {
      key: 'root',
      label: 'root',
      path: '',
      value: null,
      children: [],
      isLeaf: false,
      isExpanded: false
    }
    const nodeMap: Record<string, TreeNode> = { '': root };
    const sortedRecords = [...records].sort((a, b) => a.path.localeCompare(b.path));

    sortedRecords.forEach(record => {
      const pathSegments = record.path.split('/');
      let currentPath = '';
      let parentPath = '';
      for (let i = 1; i < pathSegments.length; i++) {
        const segment = pathSegments[i];
        if (!segment) continue;
        parentPath = currentPath;
        currentPath += '/' + segment;
        if (!nodeMap[currentPath]) {
          const label = segment.replace(/\[\d+\]$/, '');
          const newNode: TreeNode = {
            key: currentPath,
            label: label,
            path: currentPath,
            value: null,
            children: [],
            isLeaf: i == pathSegments.length - 1
          }
          nodeMap[currentPath] = newNode;
          nodeMap[parentPath].children.push(newNode);
        }
        if (i === pathSegments.length - 1) {
          nodeMap[currentPath].value = record.value;
        }
      }
    });
    return root.children;
  }

  useEffect(() => {
    if (!selectedTable) return;
    const fetchRecords = async () => {
      setIsLoadingRecords(true);
      try {
        const response = await axios.get(`http://localhost:8080/xml/records?tableName=${selectedTable}`);
        setRecords(response.data);
        // Build the tree from the flat records
        const tree = buildTree(response.data);
        setTreeData(tree);

        // Expand the first level by default
        const newExpandedKeys = new Set<string>();
        tree.forEach(node => {
          newExpandedKeys.add(node.key);
        });
        setExpandedKeys(newExpandedKeys);
      } catch (error) {
        console.log("Error fetching records", error)
      } finally {
        setIsLoadingRecords(false);
      }
    };
    fetchRecords();
  }, [selectedTable]);

  useEffect(() => {
    const fetchTableNames = async () => {
      setIsLoadingTables(true)
      try {
        const response = await axios.get(`http://localhost:8080/xml/tables`);
        setTableNames(response.data)
        if (response.data.length > 0) {
          setSelectedTable(response.data[0]);
        }
      } catch (error) {
        console.log("error fetching table names", error);
      } finally {
        setIsLoadingTables(false)
      }
    };

    fetchTableNames();
  }, []);

  // Helper function to initialize a GrapesJS editor
  const initializeEditor = (
    containerId: string, 
    content: string = '', 
    parentFrameId?: string
  ): any => {
    // Create common editor config with shared blocks, style sectors, etc.
    const editorConfig = {
      container: `#${containerId}`,
      height: "100%",
      width: "100%",
      fromElement: false,
      storageManager: { autoload: false },
      
      dragMode: 'absolute' as const,
      deviceManager: { devices: [] },
      
      canvas: {
        styles: [],
        scripts: [],
      },
      
      blockManager: {
        appendTo: `#blocks-${containerId}`,
        blocks: [
          {
            id: 'text',
            label: 'Text Box',
            category: 'Basic',
            content: {
              type: 'text',
              content: 'Insert your text here',
              style: { padding: '10px', minHeight: '50px' }
            },
            media: '<i class="fa fa-text-width"></i>'
          },
          {
            id: 'heading',
            label: 'Heading',
            category: 'Basic',
            content: {
              type: 'text',
              content: '<h1>Heading</h1>',
              style: { padding: '10px', minHeight: '50px' }
            },
            media: '<i class="fa fa-header"></i>'
          },
          {
            id: 'image',
            label: 'Image',
            category: 'Basic',
            select: true,
            content: { type: 'image' },
            media: '<i class="fa fa-image"></i>'
          },
          {
            id: 'frame',
            label: 'Frame',
            category: 'Structure',
            content: {
              type: 'frame',
              style: { 
                padding: '20px',
                minHeight: '100px',
                backgroundColor: '#e8f4fc',
                border: '1px dashed #3498db'
              }
            },
            media: '<i class="fa fa-window-maximize"></i>'
          }
        ]
      },
      
      // Configure panels with export button
      panels: {
        defaults: [
          {
            id: 'panel-top',
            el: `.panel-top-${containerId}`,
            buttons: [
              {
                id: 'save',
                className: 'btn-save',
                label: 'Save',
                command: 'save-page',
              },
              {
                id: 'export-xml',
                className: 'btn-export-xml',
                label: 'Export XML',
                command: 'export-xml',
              }
            ],
          }
        ]
      },
      
      // Enable style manager
      styleManager: {
        appendTo: `#style-manager-${containerId}`,
        sectors: [
          {
            name: 'Typography',
            open: false,
            buildProps: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'text-align', 'text-shadow', 'line-height']
          },
          {
            name: 'Dimension',
            open: false,
            buildProps: ['width', 'height', 'max-width', 'min-height', 'margin', 'padding']
          },
          {
            name: 'Decorations',
            open: false,
            buildProps: ['background-color', 'border', 'border-radius', 'box-shadow']
          },
          {
            name: 'Position',
            open: false,
            buildProps: ['position', 'top', 'left', 'bottom', 'right']
          }
        ]
      },

      // Enable layer manager
      layerManager: {
        appendTo: `#layers-container-${containerId}`
      },
      
      // Use plugins
      plugins: [],
      
      // Start with the provided content or empty
      components: content,
    };
    
    // Initialize the editor
    const editor = grapesjs.init(editorConfig);

    // Add the save command
    editor.Commands.add("save-page", {
      run(editor) {
        const html = editor.getHtml();
        const css = editor.getCss();
        console.log("HTML Output:", html);
        console.log("CSS Output:", css);
        alert("Page saved! Check the console for HTML and CSS output.");
      },
    });

    // Add the export XML command
    editor.Commands.add("export-xml", {
      run(editor) {
        const componentsJSON = editor.getComponents();
        const xmlOutput = convertToXML(componentsJSON);
        setXmlCode(xmlOutput);
        setShowXmlExport(true);
      },
    });

    // Override the text component to make it fully resizable and draggable
    editor.DomComponents.addType('text', {
      model: {
        defaults: {
          draggable: true,
          droppable: true,
          resizable: {
            tl: true, tr: true, bl: true, br: true,
            tc: true, bc: true, cl: true, cr: true
          },
          style: {
            position: 'relative',
            padding: '10px',
            minHeight: '50px',
            minWidth: '50px'
          }
        }
      }
    });

    // Define the custom Frame component
    // Define the improved Frame component with better content handling
    // Define the improved and error-proof frame component
    editor.DomComponents.addType('frame', {
      model: {
        defaults: {
          name: 'Frame',
          droppable: true,
          draggable: true,
          resizable: {
            tl: true, tr: true, bl: true, br: true,
            tc: true, bc: true, cl: true, cr: true
          },
          style: {
            position: 'relative',
            padding: '20px',
            minHeight: '100px',
            minWidth: '100px',
            backgroundColor: '#e8f4fc',
            border: '1px dashed #3498db',
            borderRadius: '4px'
          },
          // Store a unique ID for the frame
          attributes: { 'data-frame-id': Date.now().toString() },
          // Indicator for frames that can be drilled into
          icon: '<i class="fa fa-window-maximize"></i>',
          label: 'Frame',
          // Custom toolbar for frame components
          toolbar: [
            { 
              attributes: { class: 'fa fa-pencil' },
              command: 'frame-edit', // Custom command for drilling down
            },
            { 
              attributes: { class: 'fa fa-arrows' },
              command: 'tlb-move', 
            },
            { 
              attributes: { class: 'fa fa-clone' },
              command: 'tlb-clone', 
            },
            { 
              attributes: { class: 'fa fa-trash-o' },
              command: 'tlb-delete', 
            },
          ],
        }
      },
      view: {
        events: {
          'dblclick': 'onDblClick'
        } as any,
        onDblClick(e: MouseEvent) {
          e.preventDefault();
          e.stopPropagation();
          const model = this.model;
          
          // Get the editor instance from the view
          const editor = this.em as any;
          if (editor && typeof editor.Commands.run === 'function') {
            editor.Commands.run('frame-edit', { frameComponent: model });
          } else {
            console.error('Could not find editor instance for double-click handling');
          }
        },
        init() {
          const model = this.model;
          this.listenTo(model, 'change:style', this.updateStatus);
        },
        updateStatus() {
          // Update UI to show this is a drillable component
          // This can be expanded with custom styling
        }
      }
    });
    // Add command for editing frames
    // Add a more robust command for editing frames
editor.Commands.add('frame-edit', {
  run(editor, sender, options = {}) {
    const frameComponent = options.frameComponent;
    if (frameComponent) {
      try {
        // Get the frame ID, generating a new one if it doesn't exist
        let frameId = frameComponent.getAttributes()['data-frame-id'];
        if (!frameId) {
          frameId = `frame-${Date.now()}`;
          frameComponent.setAttributes({ 'data-frame-id': frameId });
        }
        
        // Get the frame's HTML content
        let frameContent = '';
        
        // Try different methods to get the content
        try {
          // Method 1: Get HTML directly from the component
          frameContent = editor.getHtml(frameComponent);
        } catch (err) {
          console.warn('Method 1 failed to get frame content:', err);
          
          try {
            // Method 2: Build HTML from components
            frameComponent.components().forEach((comp: any) => {
              frameContent += comp.toHTML();
            });
          } catch (err) {
            console.warn('Method 2 failed to get frame content:', err);
            
            try {
              // Method 3: Get from DOM element if available
              const el = frameComponent.view && frameComponent.view.el;
              if (el) {
                frameContent = el.innerHTML;
              }
            } catch (err) {
              console.warn('Method 3 failed to get frame content:', err);
            }
          }
        }
        
        // If we still don't have content, use a placeholder
        if (!frameContent || frameContent.trim() === '') {
          frameContent = '<div style="min-height: 50px;"></div>';
        }
        
        // Create a new editor for this frame's content
        createNestedEditor(frameId, frameContent);
      } catch (error) {
        console.error('Error opening frame editor:', error);
        alert('There was an error opening the frame editor. Please try again.');
      }
    } else {
      console.error('No frame component provided to frame-edit command');
    }
  }
});

    // Set default resizable options for all components
    editor.on('component:create', component => {
      if (!component.get('resizable')) {
        component.set({
          draggable: true,
          droppable: true,
          resizable: {
            tl: true, tr: true, bl: true, br: true,
            tc: true, bc: true, cl: true, cr: true
          }
        });
      }
    });

    // Track selected component
    editor.on('component:selected', (component) => {
      selectedComponentRef.current = component;
    });
    
    // Clear selected component reference when deselected
    editor.on('component:deselected', () => {
      selectedComponentRef.current = null;
    });

    return editor;
  };

// Create a new nested editor for a frame with consistent sidebars
const createNestedEditor = (frameId: string, frameContent: string) => {
  // Generate a unique ID for this nested editor
  const nestedEditorId = `nested-editor-${Date.now()}`;
  
  // Clear any previous content
  if (nestedEditorContainerRef.current) {
    nestedEditorContainerRef.current.innerHTML = '';
    
    // Create a complete editor structure with sidebars similar to the main editor
    // Now including all the same tabs as the main editor
    nestedEditorContainerRef.current.innerHTML = `
      <div class="editor-main nested-editor-structure">
        <!-- Left sidebar - Block manager -->
        <div class="panel-left">
          <div class="panel-header">
            <i class="fa fa-square"></i> Blocks
          </div>
          <div id="blocks-${nestedEditorId}" class="panel-blocks"></div>
        </div>

        <!-- Main editor canvas -->
        <div id="${nestedEditorId}" class="editor-canvas"></div>

        <!-- Right sidebar with tabs - now including all the same tabs as main editor -->
        <div class="panel-right">
          <div class="panel-tabs">
            <button class="tab-btn active" data-tab="properties">
              <i class="fa fa-pencil-alt"></i> Properties
            </button>
            <button class="tab-btn" data-tab="objects">
              <i class="fa fa-layer-group"></i> Objects
            </button>
            <button class="tab-btn" data-tab="records">
              <i class="fa fa-database"></i> Records
            </button>
          </div>
          <div class="panel-content">
            <div id="style-manager-${nestedEditorId}" class="style-manager-container" style="display: block;"></div>
            <div id="layers-container-${nestedEditorId}" class="layers-container" style="display: none;"></div>
            <div 
              id="records-${nestedEditorId}" 
              style="display: none;"
              class="records-container"
            >
              <div class="records-header">
                <h3><i class="fa fa-database"></i> XML Records</h3>
                <div class="table-selector">
                  <label for="table-select-${nestedEditorId}">Select XML Table:</label>
                  <select 
                    id="table-select-${nestedEditorId}" 
                    class="nested-table-select"
                  >
                    ${tableNames.map(name => 
                      `<option value="${name}" ${name === selectedTable ? 'selected' : ''}>${name}</option>`
                    ).join('')}
                  </select>
                </div>
              </div>
              <div class="records-content">
                <div class="tree-view">
                  ${treeData.map(node => renderTreeNodeHtml(node)).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Set up tab switching in the nested editor
    const tabButtons = nestedEditorContainerRef.current.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = (btn as HTMLElement).dataset.tab;
        
        // Update tab buttons
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show/hide panels
        const styleManager = document.getElementById(`style-manager-${nestedEditorId}`);
        const layersContainer = document.getElementById(`layers-container-${nestedEditorId}`);
        const recordsContainer = document.getElementById(`records-${nestedEditorId}`);
        
        if (styleManager && layersContainer && recordsContainer) {
          if (tabName === 'properties') {
            styleManager.style.display = 'block';
            layersContainer.style.display = 'none';
            recordsContainer.style.display = 'none';
          } else if (tabName === 'objects') {
            styleManager.style.display = 'none';
            layersContainer.style.display = 'block';
            recordsContainer.style.display = 'none';
          } else if (tabName === 'records') {
            styleManager.style.display = 'none';
            layersContainer.style.display = 'none';
            recordsContainer.style.display = 'block';
          }
        }
      });
    });
    
    // Set up nested table selector event listener
    const tableSelector = nestedEditorContainerRef.current.querySelector('.nested-table-select') as HTMLSelectElement;
    if (tableSelector) {
      tableSelector.addEventListener('change', (e) => {
        const newSelectedTable = (e.target as HTMLSelectElement).value;
        
        // We'll update the records view in the nested editor with the selected table
        // This is a simplified approach - in a real implementation, you might want to
        // make a separate API call and render the nested records view
        
        // For now, just update the main selected table which will trigger the useEffect
        setSelectedTable(newSelectedTable);
      });
    }
  }
  
  // Helper function to render tree nodes as HTML string for the nested editor
  function renderTreeNodeHtml(node: TreeNode, level: number = 0): string {
    const isExpanded = expandedKeys.has(node.key);
    const paddingLeft = level * 20;
    
    let html = `
      <div class="tree-node">
        <div class="tree-node-content" style="padding-left: ${paddingLeft}px;">
    `;
    
    if (node.children.length > 0) {
      html += `
        <span class="expand-icon ${isExpanded ? 'expanded' : ''}">
          ${isExpanded ? '▼' : '►'}
        </span>
      `;
    } else {
      html += `<span class="leaf-icon">•</span>`;
    }
    
    html += `
      <span class="node-label">${node.label}</span>
      ${node.isLeaf && node.value !== null ? `<span class="node-value">${node.value}</span>` : ''}
    </div>
    `;
    
    if (isExpanded && node.children.length > 0) {
      html += `<div class="tree-node-children">`;
      node.children.forEach(childNode => {
        html += renderTreeNodeHtml(childNode, level + 1);
      });
      html += `</div>`;
    }
    
    html += `</div>`;
    return html;
  }
  
  // Clean up frameContent to ensure it's valid HTML content
  let contentToUse = frameContent.trim();
  
  // If nothing is found, use empty content instead of breaking the editor
  if (!contentToUse) {
    contentToUse = '<div style="min-height: 50px;"></div>';
  }
  
  // Check for cached content from previous editing session
  const cachedHtml = sessionStorage.getItem(`frame-content-${frameId}-html`);
  if (cachedHtml) {
    contentToUse = cachedHtml;
  }
  
  // Initialize the nested editor
  const nestedEditor = initializeEditor(nestedEditorId, contentToUse, frameId);
  
  // Add double-click handler to make frame component editing work properly 
  nestedEditor.on('component:dblclick', (component: any) => {
    if (component.get('type') === 'frame') {
      nestedEditor.runCommand('frame-edit', { frameComponent: component });
    }
  });
  
  // Set up auto-save to prevent loss of content
  const autoSaveInterval = setInterval(() => {
    try {
      const currentHtml = nestedEditor.getHtml();
      const currentCss = nestedEditor.getCss();
      sessionStorage.setItem(`frame-content-${frameId}-html`, currentHtml);
      sessionStorage.setItem(`frame-content-${frameId}-css`, currentCss);
    } catch (err) {
      console.warn('Auto-save failed:', err);
    }
  }, 5000); // Save every 5 seconds
  
  // Load any cached CSS
  const cachedCss = sessionStorage.getItem(`frame-content-${frameId}-css`);
  if (cachedCss) {
    // Use the correct method to add CSS rules
    nestedEditor.Css.addRules(cachedCss);
  }
  
  // Keep track of this new editor instance
  setEditorInstances(prev => [
    ...prev, 
    { 
      id: nestedEditorId, 
      editor: nestedEditor, 
      containerEl: nestedEditorContainerRef.current as HTMLElement,
      parentFrameId: frameId,
      autoSaveInterval
    }
  ]);
  
  // Update the active editor index
  setActiveEditorIndex(prev => prev + 1);
  
  // Update breadcrumbs
  setEditorBreadcrumbs(prev => [...prev, `Frame ${prev.length}`]);
  
  // Show the nested editor
  setShowNestedEditor(true);
};

  // Return to parent editor and sync changes
  // The main issue is in the returnToParentEditor function
// Here's the fixed implementation for that function:

// Enhanced and fixed returnToParentEditor function with robust error handling
const returnToParentEditor = () => {
  if (activeEditorIndex <= 0) {
    // Already at the root editor, nothing to do
    return;
  }
  
  try {
    // Get the current and parent editor instances
    const currentEditorInstance = editorInstances[activeEditorIndex];
    const parentEditorIndex = activeEditorIndex - 1;
    const parentEditorInstance = editorInstances[parentEditorIndex];
    
    if (currentEditorInstance && parentEditorInstance) {
      // Get the current editor content
      const currentEditor = currentEditorInstance.editor;
      const frameId = currentEditorInstance.parentFrameId;
      
      if (!frameId) {
        console.error("Missing parent frame ID");
        throw new Error("Missing parent frame ID");
      }
      
      // Get the parent editor instance
      const parentEditor = parentEditorInstance.editor;
      
      // Find the corresponding frame component in the parent editor
      let parentFrame: any = null;
      parentEditor.getComponents().forEach((component: any) => {
        if (component.get('type') === 'frame') {
          const attrs = component.getAttributes();
          if (attrs && attrs['data-frame-id'] === frameId) {
            parentFrame = component;
          }
        }
      });
      
      if (!parentFrame) {
        // Try a deeper search if not found at the top level
        parentEditor.getComponents().forEach((component: any) => {
          if (!parentFrame) {
            findFrameDeep(component);
          }
        });
        
        // Helper function to recursively search for the frame
        function findFrameDeep(component: any) {
          if (component.get('type') === 'frame') {
            const attrs = component.getAttributes();
            if (attrs && attrs['data-frame-id'] === frameId) {
              parentFrame = component;
              return;
            }
          }
          
          component.components().forEach((child: any) => {
            if (!parentFrame) {
              findFrameDeep(child);
            }
          });
        }
      }
      
      if (parentFrame) {
        // Store the frame's important properties
        const originalStyle = parentFrame.getStyle();
        const originalAttributes = parentFrame.getAttributes();
        
        try {
          // Get HTML content from the current editor
          const frameHtml = currentEditor.getHtml();
          console.log('Frame HTML content:', frameHtml);
          
          // IMPORTANT: Always clear & add content to avoid content disappearing
          // This is the critical fix for the disappearing content issue
          
          // First, clear existing components within the frame
          parentFrame.components().reset();
          
          // Then create a temporary DOM element to parse the HTML
          const tempEl = document.createElement('div');
          tempEl.innerHTML = frameHtml;
          
          // Add each child node from the parsed HTML as a component
          Array.from(tempEl.childNodes).forEach((node: any) => {
            if (node.nodeType === 1) { // Element node
              try {
                const componentHtml = (node as HTMLElement).outerHTML;
                console.log('Adding component:', componentHtml);
                parentFrame.components().add(componentHtml);
              } catch (componentError) {
                console.error('Error adding component:', componentError);
                console.error('Problematic node:', node);
              }
            }
          });
          
          // If no content was added (empty frame), add a placeholder div
          if (parentFrame.components().length === 0) {
            console.log('No components added, creating placeholder');
            parentFrame.components().add({
              type: 'default',
              content: '',
              style: { minHeight: '50px' }
            });
          }
          
          // Make sure the frame keeps its original styles and attributes
          parentFrame.setStyle(originalStyle);
          parentFrame.setAttributes(originalAttributes);
          
          // Get CSS from the current editor and apply unique styles to parent editor
          const frameCss = currentEditor.getCss();
          console.log('Frame CSS content:', frameCss);
          
          if (frameCss) {
            const parentCss = parentEditor.getCss();
            const uniqueCss = frameCss.split('\n')
              .filter((line: string) => !parentCss.includes(line))
              .join('\n');
              
            if (uniqueCss.trim()) {
              console.log('Adding unique CSS:', uniqueCss);
              // Use the correct method to add CSS rules
              parentEditor.Css.addRules(uniqueCss);
            }
          }
          
          // Select the frame in the parent editor
          parentEditor.select(parentFrame);
        } catch (error) {
          console.error("Detailed error updating frame content:", error);
          console.error("Frame HTML content:", currentEditor.getHtml());
          console.error("Frame CSS content:", currentEditor.getCss());
          alert("There was an error updating the frame content. The frame may be empty or contain invalid content. Check the console for details.");
          
          // Restore empty frame with original properties as a fallback
          parentFrame.components().reset();
          parentFrame.setStyle(originalStyle);
          parentFrame.setAttributes(originalAttributes);
        }
      } else {
        console.error("Could not find parent frame component");
        alert("Could not find the parent frame. Changes may not be saved.");
      }
      
      // Clean up the auto-save interval if it exists
      if (currentEditorInstance.autoSaveInterval) {
        clearInterval(currentEditorInstance.autoSaveInterval);
      }
    }
  } catch (error) {
    console.error("Error returning to parent editor:", error);
    alert("There was an error returning to the parent editor. Please try again.");
  }
  
  // Update the active editor index
  setActiveEditorIndex(activeEditorIndex - 1);
  
  // Update breadcrumbs
  setEditorBreadcrumbs(prev => prev.slice(0, -1));
  
  // If we're back at the main editor, hide the nested editor
  if (activeEditorIndex - 1 === 0) {
    setShowNestedEditor(false);
  }
};

  // Initialize the main editor
  useEffect(() => {
    if (editorInstances.length === 0) {
      // Create the main editor container
      const mainEditorId = 'main-editor';
      
      // Initialize the editor
      const mainEditor = initializeEditor(mainEditorId);
      
      // Add to editor instances
      setEditorInstances([{ 
        id: mainEditorId, 
        editor: mainEditor, 
        containerEl: document.getElementById(mainEditorId) as HTMLElement 
      }]);
      
      // Store the main editor reference
      editorRef.current = mainEditor;
    }
  }, []);

  // Convert components to XML format (keeping this function from the original code)
  const convertToXML = (components: any): string => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<components>\n';
    
    const processComponent = (component: any, indent: string = '  '): string => {
      let compXml = '';
      const type = component.get('type');
      const attributes = component.getAttributes();
      const style = component.getStyle();
      
      // Start tag with type
      compXml += `${indent}<component type="${type}">\n`;
      
      // Add attributes section if any
      if (Object.keys(attributes).length) {
        compXml += `${indent}  <attributes>\n`;
        for (const [key, value] of Object.entries(attributes)) {
          compXml += `${indent}    <${key}>${value}</${key}>\n`;
        }
        compXml += `${indent}  </attributes>\n`;
      }
      
      // Add style section if any
      if (Object.keys(style).length) {
        compXml += `${indent}  <style>\n`;
        for (const [prop, value] of Object.entries(style)) {
          compXml += `${indent}    <${prop}>${value}</${prop}>\n`;
        }
        compXml += `${indent}  </style>\n`;
      }
      
      // Add content if available
      const content = component.get('content');
      if (content) {
        // Escape HTML content
        const escapedContent = content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
        
        compXml += `${indent}  <content><![CDATA[${escapedContent}]]></content>\n`;
      }
      
      // Process children components
      const components = component.get('components');
      if (components && components.length) {
        compXml += `${indent}  <children>\n`;
        components.forEach((child: any) => {
          compXml += processComponent(child, indent + '    ');
        });
        compXml += `${indent}  </children>\n`;
      }
      
      // Close component tag
      compXml += `${indent}</component>\n`;
      
      return compXml;
    };
    
    // Process all top-level components
    components.forEach((component: any) => {
      xml += processComponent(component);
    });
    
    xml += '</components>';
    return xml;
  };

  const toggleNode = (node: TreeNode) => {
    const newExpandedKeys = new Set(expandedKeys);
    if (newExpandedKeys.has(node.key)) {
      newExpandedKeys.delete(node.key);
    } else {
      newExpandedKeys.add(node.key);
    }
    setExpandedKeys(newExpandedKeys);
  };

  const renderTreeNode = (node: TreeNode, level: number = 0) => {
    const isExpanded = expandedKeys.has(node.key);

    return (
      <div key={node.key} className="tree-node">
        <div
          className="tree-node-content"
          style={{ paddingLeft: `${level * 20}px` }}
        >
          {node.children.length > 0 ? (
            <span
              className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleNode(node)}
            >
              {isExpanded ? '▼' : '►'}
            </span>
          ) : (
            <span className="leaf-icon">•</span>
          )}

          <span className="node-label">{node.label}</span>

          {node.isLeaf && node.value !== null && (
            <span className="node-value">{node.value}</span>
          )}
        </div>

        {isExpanded && node.children.length > 0 && (
          <div className="tree-node-children">
            {node.children.map(childNode => renderTreeNode(childNode, level + 1))}
          </div>
        )}
      </div>
    );
  };

  // Handle tab switching and ensure Style Manager renders correctly
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    
    if (activeTab === 'properties') {
      // Use a timeout to ensure DOM is updated before re-rendering
      setTimeout(() => {
        // Update the StyleManager's container reference
        if (styleManagerRef.current) {
          // Clear and re-append the style manager
          const styleManager = editor.StyleManager;
          styleManager.config.appendTo = styleManagerRef.current;
          
          // Force full re-render
          styleManager.render();
          
          // If a component was selected, reselect it to refresh styles
          if (selectedComponentRef.current) {
            editor.select(selectedComponentRef.current);
          }
        }
      }, 100);
    } else if (activeTab === 'objects') {
      // Use a timeout to ensure DOM is updated before re-rendering
      setTimeout(() => {
        // Update the LayerManager's container reference
        if (layersRef.current) {
          // Access the Layer Manager
          const layerManager = editor.LayerManager;
          layerManager.config.appendTo = layersRef.current;
          
          // Force full re-render
          layerManager.render();
        }
      }, 100);
    }
  }, [activeTab]);
  
  return (
    <div className="editor-container">
      {/* Top panel with improved styling */}
      <div className="panel-top">
        <div className="editor-logo">
          <FontAwesomeIcon icon={faPencilAlt} /> Website Builder
        </div>
        <div className="panel-buttons">
          <button 
            className="btn-save" 
            onClick={() => editorInstances[activeEditorIndex]?.editor.runCommand('save-page')}
          >
            <FontAwesomeIcon icon={faSave} /> Save
          </button>
          <button 
            className="btn-export" 
            onClick={() => editorInstances[activeEditorIndex]?.editor.runCommand('export-xml')}
          >
            <FontAwesomeIcon icon={faFileExport} /> Export XML
          </button>
        </div>
      </div>

      {/* Breadcrumb navigation for nested editors */}
      {showNestedEditor && (
        <div className="editor-breadcrumbs">
          {editorBreadcrumbs.map((crumb, index) => (
            <span key={index} className="breadcrumb-item">
              {index > 0 && <span className="breadcrumb-separator">/</span>}
              <span 
                className={`breadcrumb-text ${index === activeEditorIndex ? 'active' : ''}`}
                onClick={() => {
                  // Navigate back to this level if it's a parent
                  if (index < activeEditorIndex) {
                    // Navigate back to each parent level one at a time
                    // to ensure each level's content is properly synced
                    for (let i = activeEditorIndex; i > index; i--) {
                      returnToParentEditor();
                    }
                  }
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
          {activeEditorIndex > 0 && (
            <button className="back-to-parent" onClick={returnToParentEditor}>
              <FontAwesomeIcon icon={faArrowUp} /> Back to Parent
            </button>
          )}
        </div>
      )}

      {/* Conditional rendering of the main or nested editor */}
      <div className={`editor-main ${showNestedEditor ? 'hidden' : ''}`}>
        {/* Left sidebar - Block manager with better styling */}
        <div className="panel-left">
          <div className="panel-header">
            <FontAwesomeIcon icon={faSquare} /> Blocks
          </div>
          <div id="blocks-main-editor" className="panel-blocks"></div>
        </div>

        {/* Main editor container */}
        <div id="main-editor" className="editor-canvas"></div>

        {/* Right sidebar with tabs */}
        <div className="panel-right">
          <div className="panel-tabs">
            <button 
              className={`tab-btn ${activeTab === 'properties' ? 'active' : ''}`}
              onClick={() => setActiveTab('properties')}
            >
              <FontAwesomeIcon icon={faPencilAlt} /> Properties
            </button>
            <button 
              className={`tab-btn ${activeTab === 'objects' ? 'active' : ''}`}
              onClick={() => setActiveTab('objects')}
            >
              <FontAwesomeIcon icon={faLayerGroup} /> Objects
            </button>
            <button 
              className={`tab-btn ${activeTab === 'records' ? 'active' : ''}`}
              onClick={() => setActiveTab('records')}
            >
              <FontAwesomeIcon icon={faDatabase} /> Records
            </button>
          </div>
          <div className="panel-content">
            {/* Conditional rendering of panels */}
            <div 
              id="style-manager-main-editor" 
              ref={styleManagerRef} 
              style={{ display: activeTab === 'properties' ? 'block' : 'none' }}
              className="style-manager-container"
            ></div>
            <div 
              id="layers-container-main-editor" 
              ref={layersRef}
              style={{ display: activeTab === 'objects' ? 'block' : 'none' }}
              className="layers-container"
            ></div>
            <div 
              id="records" 
              style={{ display: activeTab === 'records' ? 'block' : 'none' }}
              className="records-container"
            >
              <div className="records-header">
                <h3><FontAwesomeIcon icon={faDatabase} /> XML Records</h3>
                <div className="table-selector">
                  <label htmlFor="table-select">Select XML Table:</label>
                  <select 
                    id="table-select" 
                    value={selectedTable}
                    onChange={(e) => setSelectedTable(e.target.value)}
                    disabled={isLoadingTables}
                  >
                    {isLoadingTables ? (
                      <option>Loading tables...</option>
                    ) : tableNames.length === 0 ? (
                      <option>No tables available</option>
                    ) : (
                      tableNames.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="records-content">
                {isLoadingRecords ? (
                  <div className="loading">Loading records...</div>
                ) : treeData.length === 0 ? (
                  <div className="no-records">No records found for this table.</div>
                ) : (
                  <div className="tree-view">
                    {treeData.map(node => renderTreeNode(node))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Nested editor container (shown when editing a frame) */}
      <div 
        className={`nested-editor-main ${showNestedEditor ? '' : 'hidden'}`}
        ref={nestedEditorContainerRef}
      ></div>

      {/* XML Export Modal */}
      {showXmlExport && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3><FontAwesomeIcon icon={faFileExport} /> XML Export</h3>
              <button 
                className="close-btn"
                onClick={() => setShowXmlExport(false)}
              >×</button>
            </div>
            <div className="modal-content">
              <pre className="xml-code">{xmlCode}</pre>
            </div>
            <div className="modal-footer">
              <button 
                className="copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(xmlCode);
                  alert("XML copied to clipboard!");
                }}
              >
                Copy to Clipboard
              </button>
              <button 
                className="close-btn"
                onClick={() => setShowXmlExport(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditorGrapes;
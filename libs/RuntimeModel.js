jQuery.sap.declare("inspur.gsp.commons.RuntimeModel")

sap.ui.model.json.JSONModel.extend("inspur.gsp.commons.RuntimeModel", {

  constructor : function(arg) {
    if (arg.constructor == sap.ui.commons.TabStrip) {
      this.container = arg
      sap.ui.model.json.JSONModel.apply(this)
    } else {
      sap.ui.model.json.JSONModel.apply(this, arguments)
    }
  }

  , openFunc  : function(sComponentId, oCallbacks) {
    // debugger
      
      // var currentComponent = this.container.byId(sComponentId);
      // oCallbacks();   // 调用回调函数
  }
  
})